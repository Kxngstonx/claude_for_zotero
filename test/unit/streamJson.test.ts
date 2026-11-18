import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyError,
  LineBuffer,
  parseJsonLine,
  textDelta,
  TurnCollector,
  userMessage,
} from "../../src/llm/streamJson.ts";

test("LineBuffer splits across chunk boundaries and keeps the partial tail", () => {
  const b = new LineBuffer();
  assert.deepEqual(b.push('{"a":1}\n{"b"'), ['{"a":1}']);
  assert.deepEqual(b.push(":2}\n\n"), ['{"b":2}', ""]);
  assert.deepEqual(b.push('{"c":3}'), []);
  assert.equal(b.flush(), '{"c":3}');
  assert.equal(b.flush(), null);
});

test("parseJsonLine ignores non-JSON and broken lines", () => {
  assert.deepEqual(parseJsonLine(' {"x":1} '), { x: 1 });
  assert.equal(parseJsonLine("```"), null);
  assert.equal(parseJsonLine('{"x":'), null);
  assert.equal(parseJsonLine(""), null);
});

const delta = (type: string, extra: object) => ({
  type: "stream_event",
  event: { type: "content_block_delta", delta: { type, ...extra } },
});

test("textDelta returns only text_delta text", () => {
  assert.equal(textDelta(delta("text_delta", { text: "PONG" })), "PONG");
  assert.equal(textDelta(delta("thinking_delta", { thinking: "hm" })), null);
  assert.equal(textDelta(delta("signature_delta", { signature: "x" })), null);
  assert.equal(textDelta({ type: "assistant" }), null);
});

// Event sequence recorded from claude 2.1.326 (abridged).
const success = [
  {
    type: "system",
    subtype: "init",
    session_id: "s1",
    model: "claude-haiku-5-5",
    tools: [],
  },
  delta("thinking_delta", { thinking: "" }),
  delta("text_delta", { text: "PO" }),
  delta("text_delta", { text: "NG" }),
  { type: "assistant", message: { content: [{ type: "text", text: "PONG" }] } },
  { type: "rate_limit_event", rate_limit_info: { status: "allowed" } },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "PONG",
    session_id: "s1",
  },
];

test("TurnCollector collects streamed text and session id", () => {
  const t = new TurnCollector();
  const seen: string[] = [];
  for (const ev of success) {
    const d = t.add(ev);
    if (d) seen.push(d);
  }
  assert.deepEqual(seen, ["PO", "NG"]);
  assert.equal(t.finalText(), "PONG");
  assert.equal(t.sessionId, "s1");
  assert.equal(t.model, "claude-haiku-5-5");
  assert.equal(t.error(), null);
});

test("TurnCollector reports model_not_found as a model error", () => {
  const t = new TurnCollector();
  const msg = "There's an issue with the selected model (no-such-model).";
  t.add({
    type: "assistant",
    error: "model_not_found",
    message: { content: [{ type: "text", text: msg }] },
  });
  t.add({
    type: "result",
    subtype: "success",
    is_error: true,
    result: msg,
    api_error_status: 404,
  });
  assert.deepEqual(t.error(), { kind: "model", message: msg });
  assert.equal(t.finalText(), "");
});

test("TurnCollector maps a rejected rate limit event to limit", () => {
  const t = new TurnCollector();
  t.add({ type: "rate_limit_event", rate_limit_info: { status: "rejected" } });
  t.add({
    type: "result",
    subtype: "success",
    is_error: true,
    result: "Something failed",
  });
  assert.equal(t.error()?.kind, "limit");
});

test("TurnCollector ignores sub-agent events", () => {
  const t = new TurnCollector();
  t.add({ ...delta("text_delta", { text: "x" }), parent_tool_use_id: "t1" });
  assert.equal(t.text, "");
});

test("classifyError uses the category first, then the documented messages", () => {
  assert.equal(classifyError("authentication_failed", ""), "auth");
  assert.equal(classifyError("rate_limit", ""), "limit");
  assert.equal(
    classifyError(null, "Not logged in · Please run /login"),
    "auth",
  );
  assert.equal(
    classifyError(null, "You've hit your session limit · resets 3:45pm"),
    "limit",
  );
  assert.equal(classifyError(null, "boom"), "other");
});

test("userMessage builds one stream-json line", () => {
  const line = userMessage([{ type: "text", text: "hi" }]);
  assert.ok(line.endsWith("\n"));
  assert.equal(line.trim().includes("\n"), false);
  assert.deepEqual(JSON.parse(line), {
    type: "user",
    message: { role: "user", content: [{ type: "text", text: "hi" }] },
  });
});

test("TurnCollector separates text blocks around a tool call", () => {
  const t = new TurnCollector();
  const start = {
    type: "stream_event",
    event: { type: "content_block_start", content_block: { type: "text" } },
  };
  t.add(start);
  t.add(delta("text_delta", { text: "Let me read it." }));
  t.add({
    type: "stream_event",
    event: { type: "content_block_start", content_block: { type: "tool_use" } },
  });
  t.add(start);
  t.add(delta("text_delta", { text: "The answer." }));
  assert.equal(t.text, "Let me read it.\n\nThe answer.");
});

import { claudeErrorText, resetTime } from "../../src/llm/streamJson.ts";

test("claudeErrorText says what to do for each kind", () => {
  assert.match(claudeErrorText("not_found", ""), /claude 경로를 입력/);
  assert.match(
    claudeErrorText("auth", "Not logged in · Please run /login"),
    /\/login 한 뒤[\s\S]*\(Not logged in/,
  );
  assert.match(
    claudeErrorText("limit", "You've hit your session limit · resets 3:45pm"),
    /^Claude 사용량 한도에 도달했습니다\. 3:45pm 이후 다시 시도하세요/,
  );
  assert.match(claudeErrorText("limit", "rate_limit"), /잠시 후 다시 시도/);
  assert.match(
    claudeErrorText("model", "There's an issue with the selected model"),
    /연결 테스트/,
  );
  assert.match(
    claudeErrorText("timeout", "600초 안에 응답이 끝나지 않았습니다."),
    /^600초 안에[\s\S]*타임아웃은 설정/,
  );
  assert.equal(
    claudeErrorText("other", "boom"),
    "Claude 실행 중 오류가 났습니다: boom",
  );
});

test("resetTime keeps parentheses and dotted dates", () => {
  assert.equal(
    resetTime("You've hit your limit · resets 3pm (Asia/Seoul)"),
    "3pm (Asia/Seoul)",
  );
  assert.equal(resetTime("limit · resets 3am ∙ /upgrade to Max"), "3am");
  assert.equal(resetTime("weekly limit · resets Nov. 20."), "Nov. 20");
  assert.equal(resetTime("no time here"), null);
});

const textEvent = (text: string) => ({
  type: "stream_event",
  event: { type: "content_block_delta", delta: { type: "text_delta", text } },
});
const okResult = { type: "result", subtype: "success", is_error: false };

test("TurnCollector drops retracted text on a refusal fallback", () => {
  const c = new TurnCollector();
  c.add(textEvent("## 1 Summary\n2"));
  c.add({
    type: "system",
    subtype: "model_refusal_fallback",
    trigger: "refusal",
    direction: "retry",
    original_model: "claude-opus-5-5",
    fallback_model: "claude-sonnet-5-5",
    api_refusal_category: "cyber",
  });
  // The refused message may arrive after the fallback started.
  c.add({
    type: "assistant",
    message: { model: "claude-opus-5-5", stop_reason: "refusal", content: [] },
  });
  c.add(textEvent("fallback answer"));
  c.add(okResult);
  assert.equal(c.text, "fallback answer");
  assert.equal(c.model, "claude-sonnet-5-5");
  assert.deepEqual(c.refusalFallback, {
    from: "claude-opus-5-5",
    to: "claude-sonnet-5-5",
  });
  assert.equal(c.refusalCategory, "cyber");
  assert.equal(c.error(), null);
});

test("TurnCollector reports a refusal without fallback", () => {
  const c = new TurnCollector();
  c.add(textEvent("partial"));
  c.add({
    type: "system",
    subtype: "model_refusal_no_fallback",
    original_model: "claude-opus-5-5",
    api_refusal_category: "bio",
  });
  c.add(okResult);
  assert.deepEqual(c.error(), { kind: "refusal", message: "bio" });
});

test("TurnCollector reports a refused final message", () => {
  const c = new TurnCollector();
  c.add({
    type: "assistant",
    message: {
      model: "claude-opus-5-5",
      stop_reason: "refusal",
      stop_details: { category: "cyber" },
      content: [],
    },
  });
  c.add(okResult);
  assert.equal(c.error()?.kind, "refusal");
  assert.match(claudeErrorText("refusal", "cyber"), /안전 필터.*cyber/);
});

test("TurnCollector counts Read calls", () => {
  const c = new TurnCollector();
  c.add({
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", name: "Read", input: {} },
        { type: "text", text: "x" },
      ],
    },
  });
  assert.equal(c.reads, 1);
});

// Shape observed with claude 2.1.327 (MineGrad, 2026-11-18).
const messageStart = {
  type: "stream_event",
  event: { type: "message_start", message: { model: "claude-opus-5-5" } },
};
const refusalStop = {
  type: "stream_event",
  event: {
    type: "message_delta",
    delta: {
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber" },
    },
  },
};

test("TurnCollector: refusal stop, then the same model continues", () => {
  const c = new TurnCollector();
  c.add({ type: "system", subtype: "init", model: "claude-opus-5-5" });
  c.add(messageStart);
  c.add(textEvent("기존 연구의 한계는 PEFT는"));
  c.add(refusalStop);
  c.add({
    type: "system",
    subtype: "informational",
    content:
      "Opus 5.5's safeguards stopped the response above · continuing once with that noted",
  });
  c.add(messageStart);
  c.add(textEvent("여기서 멈추겠습니다."));
  c.add(okResult);
  assert.equal(c.text, "여기서 멈추겠습니다.");
  assert.deepEqual(c.refusalFallback, {
    from: "claude-opus-5-5",
    to: "claude-opus-5-5",
  });
  assert.equal(c.refusalCategory, "cyber");
  assert.equal(c.error(), null);
});

test("TurnCollector: refusal stop without a continuation is an error", () => {
  const c = new TurnCollector();
  c.add(messageStart);
  c.add(textEvent("partial"));
  c.add(refusalStop);
  c.add(okResult);
  assert.deepEqual(c.error(), { kind: "refusal", message: "cyber" });
});
