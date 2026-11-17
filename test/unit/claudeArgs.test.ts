import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidatePaths,
  compareVersions,
  modelsFromControlResponse,
  oneShotArgs,
  parseVersion,
} from "../../src/llm/claudeArgs.ts";

test("candidatePaths: configured first, §5.1 order, PATH last, no duplicates", () => {
  const list = candidatePaths(
    "/Users/u",
    "/opt/homebrew/bin:/x/bin/",
    " /custom/claude ",
  );
  assert.deepEqual(list, [
    "/custom/claude",
    "/Users/u/.local/bin/claude",
    "/Users/u/.claude/local/claude",
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "/usr/bin/claude",
    "/x/bin/claude",
  ]);
  assert.equal(candidatePaths("/h", "", "")[0], "/h/.local/bin/claude");
});

test("candidatePaths expands ~/ and drops relative entries", () => {
  const list = candidatePaths("/h", ".:node_modules/.bin:/ok", "~/bin/claude");
  assert.equal(list[0], "/h/bin/claude");
  assert.ok(list.every((p) => p.startsWith("/")));
  assert.equal(list.at(-1), "/ok/claude");
  assert.equal(
    candidatePaths("/h", "", "bin/claude")[0],
    "/h/.local/bin/claude",
  );
});

test("parseVersion / compareVersions", () => {
  assert.deepEqual(parseVersion("2.1.326 (Claude Code)"), [2, 1, 326]);
  assert.equal(parseVersion("nope"), null);
  assert.ok(compareVersions([2, 1, 326], [2, 1, 99]) > 0);
  assert.ok(compareVersions([1, 9, 0], [2, 0, 0]) < 0);
  assert.equal(compareVersions([2, 0, 0], [2, 0, 0]), 0);
});

test("oneShotArgs disables tools and user settings and replaces the system prompt", () => {
  const a = oneShotArgs({ model: "sonnet", systemPromptFile: "/r/sys.md" });
  const after = (flag: string) => a[a.indexOf(flag) + 1];
  assert.equal(after("--tools"), "");
  assert.equal(after("--setting-sources"), "local");
  assert.equal(after("--permission-mode"), "dontAsk");
  assert.equal(after("--system-prompt-file"), "/r/sys.md");
  assert.equal(after("--model"), "sonnet");
  for (const f of [
    "--strict-mcp-config",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--include-partial-messages",
  ]) {
    assert.ok(a.includes(f), f);
  }
  assert.equal(a.includes("--append-system-prompt-file"), false);
  assert.equal(a.includes("--effort"), false);
  const b = oneShotArgs({
    model: "opus",
    systemPromptFile: "x",
    effort: "high",
  });
  assert.equal(b[b.indexOf("--effort") + 1], "high");
});

test("modelsFromControlResponse", () => {
  assert.equal(modelsFromControlResponse({ type: "system" }), null);
  assert.deepEqual(
    modelsFromControlResponse({
      type: "control_response",
      response: {
        subtype: "success",
        response: { models: [{ value: "opus" }] },
      },
    }),
    [{ value: "opus" }],
  );
  assert.throws(() =>
    modelsFromControlResponse({
      type: "control_response",
      response: { subtype: "error", error: "bad" },
    }),
  );
});

import { chatArgs } from "../../src/llm/claudeArgs.ts";

test("chatArgs confines Read to the working directory and resumes", () => {
  const a = chatArgs({ model: "sonnet", systemPromptFile: "/c/sys.md" });
  const after = (flag: string) => a[a.indexOf(flag) + 1];
  assert.equal(after("--tools"), "Read");
  assert.equal(after("--allowedTools"), "Read(./**)");
  assert.ok(a.includes("--restricted"));
  assert.ok(a.includes("--include-partial-messages"));
  assert.equal(after("--permission-mode"), "dontAsk");
  assert.equal(
    a.includes("--no-session-persistence"),
    false,
    "sessions must persist for --resume",
  );
  assert.equal(a.includes("--resume"), false);
  const b = chatArgs({ model: "sonnet", systemPromptFile: "x", resume: "abc" });
  assert.equal(b[b.indexOf("--resume") + 1], "abc");
});
