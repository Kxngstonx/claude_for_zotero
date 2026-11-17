import { test } from "node:test";
import assert from "node:assert/strict";
import { promptAction } from "../../src/promptUpdate.ts";

test("promptAction creates, updates unedited old defaults, keeps edits", () => {
  const known = ["v1", "v2"];
  assert.equal(promptAction(null, "v2", known), "create");
  assert.equal(promptAction("v2", "v2", known), "keep"); // current
  assert.equal(promptAction("v1", "v2", known), "update"); // unedited old default
  assert.equal(promptAction("edited", "v2", known), "keep"); // user edit
  assert.equal(promptAction("v1", "v2", []), "keep"); // no history: be safe
});
