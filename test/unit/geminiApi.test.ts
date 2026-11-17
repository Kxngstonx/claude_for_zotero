import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkStatus,
  generateBody,
  generateUrl,
  GeminiError,
  responseText,
} from "../../src/llm/geminiApi.ts";

test("generateUrl and body follow the documented REST shape", () => {
  assert.equal(
    generateUrl("gemini-3.5-flash-lite"),
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
  );
  assert.deepEqual(generateBody("S", "U"), {
    systemInstruction: { parts: [{ text: "S" }] },
    contents: [{ role: "user", parts: [{ text: "U" }] }],
    generationConfig: { temperature: 0.2 },
  });
});

test("checkStatus classifies 429 as rate_limit and bad keys as auth", () => {
  assert.doesNotThrow(() => checkStatus(200, "{}"));
  const kind = (status: number, body: string) => {
    try {
      checkStatus(status, body);
    } catch (e) {
      return (e as GeminiError).kind;
    }
    return "ok";
  };
  assert.equal(kind(429, '{"error":{"message":"quota"}}'), "rate_limit");
  assert.equal(kind(400, '{"error":{"message":"API key not valid."}}'), "auth");
  assert.equal(kind(403, "{}"), "auth");
  assert.equal(kind(500, "oops"), "http");
});

test("responseText joins candidate parts and rejects empty output", () => {
  const body = JSON.stringify({
    candidates: [
      { content: { parts: [{ text: "안녕" }, { text: "하세요 " }] } },
    ],
  });
  assert.equal(responseText(body), "안녕하세요");
  assert.throws(
    () =>
      responseText(
        JSON.stringify({ candidates: [{ finishReason: "SAFETY" }] }),
      ),
    /SAFETY/,
  );
});

import { geminiErrorMessage } from "../../src/llm/geminiApi.ts";

test("geminiErrorMessage points to the setting to fix", () => {
  assert.match(
    geminiErrorMessage(new GeminiError("no_key", "")),
    /API 키를 입력/,
  );
  assert.match(
    geminiErrorMessage(new GeminiError("http", "not found", 404)),
    /모델 ID를 찾을 수 없습니다/,
  );
  assert.match(geminiErrorMessage(new GeminiError("http", "", 0)), /네트워크/);
  assert.match(
    geminiErrorMessage(new GeminiError("rate_limit", "quota", 429)),
    /속도 제한/,
  );
});
