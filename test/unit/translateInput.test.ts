import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTranslateMessage,
  translateCacheKey,
} from "../../src/features/translateInput.ts";

test("buildTranslateMessage keeps text as written, including math", () => {
  const m = buildTranslateMessage({
    title: "FedX",
    before: "Let a < b.",
    target: "it holds",
    after: "",
  });
  assert.equal(
    m,
    "<title>FedX</title>\n<context_before>Let a < b.</context_before>\n<target>it holds</target>\n<context_after></context_after>",
  );
});

test("translateCacheKey depends on target and context, not title", () => {
  const a = { title: "T1", target: "x", before: "b", after: "a" };
  assert.equal(translateCacheKey(a), translateCacheKey({ ...a, title: "T2" }));
  assert.notEqual(
    translateCacheKey(a),
    translateCacheKey({ ...a, before: "" }),
  );
});
