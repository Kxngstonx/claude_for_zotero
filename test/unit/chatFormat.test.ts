import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyHistory,
  firstTurnText,
  parseHistory,
  questionFor,
  toolStatus,
} from "../../src/chat/chatFormat.ts";

test("parseHistory accepts v1 files and recovers from bad input", () => {
  const h = {
    version: 1,
    sessionId: "s1",
    messages: [{ role: "user", text: "q", at: "t" }, { bad: true }],
  };
  assert.deepEqual(parseHistory(JSON.stringify(h)), {
    version: 1,
    sessionId: "s1",
    messages: [{ role: "user", text: "q", at: "t" }],
  });
  assert.deepEqual(parseHistory("{not json"), emptyHistory());
  assert.deepEqual(parseHistory(null), emptyHistory());
});

test("firstTurnText marks a missing context note", () => {
  const t = firstTurnText(
    {
      paperMeta: "Title: T",
      contextNote: "",
      documentMap: "s01_Intro_p1.md | Intro | p.1 | ~10 tokens",
      previousQa: "",
    },
    "q",
  );
  assert.match(
    t,
    /<context_note>\n\(none: [^\n]*section files\)\n<\/context_note>/,
  );
});

test("firstTurnText puts the §10.3 block before the first question", () => {
  const t = firstTurnText(
    {
      paperMeta: "Title: T",
      contextNote: "note with </context_note> inside",
      documentMap: "s01_Intro_p1.md | Intro | p.1 | ~10 tokens",
      previousQa: "",
    },
    "전체 실험 설계는 타당한가?",
  );
  assert.match(
    t,
    /^<paper_meta>\nTitle: T\n<\/paper_meta>\n\n<context_note>\nnote with &lt;\/context_note> inside\n<\/context_note>\n\n<document_map>\ns01_Intro_p1\.md/,
  );
  assert.match(
    t,
    /<previous_qa>\n\n<\/previous_qa>\n\n전체 실험 설계는 타당한가\?$/,
  );
});

test("toolStatus names the section being read", () => {
  const ev = {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name: "Read",
          input: { file_path: "/x/sections/s03_Method_p4-6.md" },
        },
      ],
    },
  };
  assert.equal(toolStatus(ev), "s03_Method_p4-6.md 읽는 중…");
  assert.equal(
    toolStatus({ type: "assistant", message: { content: [{ type: "text" }] } }),
    null,
  );
  assert.equal(toolStatus({ ...ev, parent_tool_use_id: "t" }), null);
});

test("questionFor finds the user message an answer belongs to", () => {
  const m = [
    { role: "user" as const, text: "q1", at: "" },
    { role: "assistant" as const, text: "a1", at: "" },
    { role: "notice" as const, text: "n", at: "" },
    { role: "user" as const, text: "q2", at: "" },
    { role: "assistant" as const, text: "a2", at: "" },
  ];
  assert.equal(questionFor(m, 1), "q1");
  assert.equal(questionFor(m, 4), "q2");
  assert.equal(questionFor(m, 0), "");
});
