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
