import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLogLine } from "../../src/logFormat.ts";

test("formatLogLine writes one JSON line with metadata only", () => {
  const t = new Date("2026-11-17T08:00:00Z");
  const line = formatLogLine(
    {
      feature: "memo",
      ok: false,
      model: "claude-sonnet-5-5",
      ms: 1234.6,
      kind: "limit",
      error: "You've hit your session limit\n · resets 3:45pm",
      detail: { questions: 3 },
    },
    t,
  );
  assert.ok(line.endsWith("\n") && !line.trim().includes("\n"));
  assert.deepEqual(JSON.parse(line), {
    t: "2026-11-17T08:00:00.000Z",
    feature: "memo",
    ok: false,
    model: "claude-sonnet-5-5",
    ms: 1235,
    kind: "limit",
    error: "You've hit your session limit · resets 3:45pm",
    detail: { questions: 3 },
  });
});

test("formatLogLine truncates long errors and omits empty fields", () => {
  const line = JSON.parse(
    formatLogLine({
      feature: "chat",
      ok: false,
      error: "x".repeat(1000),
      detail: {},
    }),
  );
  assert.equal(line.error.length, 300);
  assert.ok(line.error.endsWith("…"));
  assert.equal("detail" in line, false);
  assert.equal("model" in line, false);
});
