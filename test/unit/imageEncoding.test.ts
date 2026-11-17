import { test } from "node:test";
import assert from "node:assert/strict";
import { base64, scaledSize } from "../../src/pdf/imageEncoding.ts";

test("base64 matches the platform encoder for all padding cases", () => {
  for (const len of [0, 1, 2, 3, 4, 5, 255, 1000]) {
    const bytes = Uint8Array.from(
      { length: len },
      (_, i) => (i * 37 + 11) & 255,
    );
    assert.equal(
      base64(bytes),
      Buffer.from(bytes).toString("base64"),
      `len ${len}`,
    );
  }
});

test("scaledSize keeps aspect ratio and never upscales", () => {
  assert.deepEqual(scaledSize(3136, 1000), { width: 1568, height: 500 });
  assert.deepEqual(scaledSize(800, 3136), { width: 400, height: 1568 });
  assert.deepEqual(scaledSize(1000, 500), { width: 1000, height: 500 });
});
