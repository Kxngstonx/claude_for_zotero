import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatPages,
  looksLikeNoTextLayer,
  splitPages,
} from "../../src/pdf/pagesText.ts";
import {
  contextNoteHtml,
  contextNoteUserMessage,
  formatDate,
  promptVersion,
  shortTitle,
} from "../../src/notes/contextNoteFormat.ts";

test("splitPages trusts the cache only when the piece count matches", () => {
  assert.deepEqual(splitPages("a\fb\fc", 3), ["a", "b", "c"]);
  assert.equal(splitPages("a\fb\fc", 4), null); // e.g. index stopped early
  assert.equal(splitPages("no form feeds at all", 9), null); // synced text
  assert.equal(splitPages("", 1), null);
});

test("formatPages uses 1-based page markers", () => {
  assert.equal(
    formatPages([" one \n", "two"]),
    "=== Page 1 ===\none\n\n=== Page 2 ===\ntwo",
  );
});

test("looksLikeNoTextLayer flags near-empty extraction", () => {
  assert.equal(looksLikeNoTextLayer(["", " ", "x"]), true);
  assert.equal(looksLikeNoTextLayer([]), true);
  assert.equal(looksLikeNoTextLayer(["word ".repeat(30)]), false);
});

test("promptVersion reads the header comment", () => {
  assert.equal(
    promptVersion("<!-- prompt-version: context-note v1\n  기반: …"),
    "context-note v1",
  );
  assert.equal(
    promptVersion("<!-- prompt-version: memo-batch v1. 실행 시 …"),
    "memo-batch v1",
  );
  assert.equal(
    promptVersion("<!-- prompt-version: context-note v1.1 -->"),
    "context-note v1.1",
  );
  assert.equal(promptVersion("no header"), "unknown");
});

test("user message carries meta and page-marked text", () => {
  const m = contextNoteUserMessage(
    { title: "T", authors: ["A B", "C D"], year: "2024", venue: "" },
    "=== Page 1 ===\nx",
  );
  assert.match(
    m,
    /<paper_meta>\nTitle: T\nAuthors: A B; C D\nYear: 2024\nVenue: \(unknown\)\n<\/paper_meta>/,
  );
  assert.match(m, /<full_text>\n=== Page 1 ===\nx\n<\/full_text>$/);
});

test("shortTitle prefers the short title and truncates", () => {
  assert.equal(shortTitle("Long Title", "Short"), "Short");
  assert.equal(shortTitle("x".repeat(80)).length, 58);
});

test("contextNoteHtml: root, escaped title, meta line, shifted headings", () => {
  const html = contextNoteHtml({
    title: "A<B",
    model: "claude-opus-5-5",
    date: new Date(2026, 10, 17, 9, 5),
    promptVersion: "context-note v1",
    source: "worker",
    pageCount: 12,
    markdown: "# 1️⃣ Abstract\nText [Sec 1, p.1] with $x$.",
  });
  assert.equal(formatDate(new Date(2026, 10, 17, 9, 5)), "2026-11-17 09:05");
  assert.equal(
    html,
    '<div data-schema-version="9"><h1>Claude 컨텍스트 노트 — A&lt;B</h1>' +
      "<p>생성: claude-opus-5-5 · 2026-11-17 09:05 · 프롬프트 context-note v1 · 본문 12쪽 (PDF 추출)</p>" +
      '<h2>1️⃣ Abstract</h2><p>Text [Sec 1, p.1] with <span class="math">$x$</span>.</p></div>',
  );
});
