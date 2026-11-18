import { test } from "node:test";
import assert from "node:assert/strict";
import { markAnswered, pendingQuestions } from "../../src/memo/memoSyntax.ts";
import {
  approxContext,
  charRangeInRects,
  paragraphContext,
} from "../../src/memo/paragraphs.ts";
import {
  AnswerStream,
  buildMemoContent,
  memoTimeoutSec,
  neutralizeTags,
  normalizeAnswer,
  splitBatches,
  type MemoQuestion,
} from "../../src/memo/batch.ts";
import {
  appendEntry,
  hasAnnRef,
  previousQaText,
  qaEntryHtml,
  qaMetaLine,
  qaNoteHtml,
} from "../../src/notes/qaFormat.ts";

// ------------------------------------------------------------ memo syntax

test("pendingQuestions: one question per '@claude ' line, ✓ lines skipped", () => {
  const c =
    "my note\n@claude why <i>x</i>?\n  @claude  second\n@claude ✓ done\n@claudeX no\n@claude\nnot @claude here";
  assert.deepEqual(pendingQuestions(c), [
    { line: 2, question: "why <i>x</i>?" },
    { line: 3, question: "second" },
  ]);
  assert.deepEqual(pendingQuestions(null), []);
  assert.deepEqual(pendingQuestions("@claude ✓done already"), []);
});

test("markAnswered changes only that line, keeps the rest byte for byte", () => {
  const c = "<b>keep</b>\n@claude q1\n  @claude q2\ntail ";
  assert.equal(
    markAnswered(c, 2, "q1"),
    "<b>keep</b>\n@claude ✓ q1\n  @claude q2\ntail ",
  );
  assert.equal(
    markAnswered(c, 3, "q2"),
    "<b>keep</b>\n@claude q1\n  @claude ✓ q2\ntail ",
  );
});

test("markAnswered follows the question if lines moved, null if gone", () => {
  const moved = "new first line\n@claude q1";
  assert.equal(markAnswered(moved, 1, "q1"), "new first line\n@claude ✓ q1");
  assert.equal(markAnswered("@claude ✓ q1", 1, "q1"), null);
  assert.equal(markAnswered("@claude other", 1, "q1"), null);
});

// ------------------------------------------------------------ paragraphs

test("charRangeInRects mirrors the reader: first/last char centers", () => {
  const chars = [0, 1, 2, 3, 4].map((i) => ({
    c: "abcde"[i],
    rect: [i * 10, 0, i * 10 + 8, 10],
  }));
  // rect covering centers of b..d (x 14..34)
  assert.deepEqual(charRangeInRects(chars, [[12, 0, 36, 10]]), {
    start: 1,
    end: 4,
  });
  // two rects: first starts at c, last ends at e
  assert.deepEqual(
    charRangeInRects(chars, [
      [22, 0, 26, 10],
      [40, 0, 50, 10],
    ]),
    { start: 2, end: 5 },
  );
  assert.equal(charRangeInRects(chars, [[100, 0, 120, 10]]), null);
  assert.equal(charRangeInRects([], [[0, 0, 1, 1]]), null);
});

test("paragraphContext returns containing paragraph ± n", () => {
  const t = "P1 a.\nP2 b.\nP3 target here.\nP4 d.\nP5 e.";
  const s = t.indexOf("target");
  assert.equal(
    paragraphContext(t, s, s + 6, 1),
    "P2 b.\n\nP3 target here.\n\nP4 d.",
  );
  assert.equal(paragraphContext(t, s, s + 6, 0), "P3 target here.");
  // spanning two paragraphs
  assert.equal(
    paragraphContext(t, t.indexOf("P2"), s, 0),
    "P2 b.\n\nP3 target here.",
  );
  assert.equal(paragraphContext(t, 0, 2, 9), t.split("\n").join("\n\n"));
});

test("approxContext marks cut ends", () => {
  const t = "x".repeat(2000);
  const r = approxContext(t, 1000, 1010, 800);
  assert.ok(r.startsWith("…") && r.endsWith("…"));
  assert.equal(r.length, 1610 + 2);
  assert.equal(approxContext("short", 0, 5), "short");
});

// ------------------------------------------------------------ batches

const q = (i: number, image = false): MemoQuestion => ({
  ref: `K${i}#1`,
  annotationKey: `K${i}`,
  attachmentID: 1,
  line: 1,
  question: `question ${i}`,
  kind: image ? "image" : "highlight",
  pageLabel: String(i),
  pageIndex: i - 1,
  highlight: `hl ${i}`,
  surrounding: `ctx ${i}`,
  approx: false,
  image: image ? { mediaType: "image/png", data: "AAAA" } : undefined,
});

test("splitBatches keeps order and splits only on budgets", () => {
  const qs = [1, 2, 3, 4, 5].map((i) => q(i));
  assert.deepEqual(
    splitBatches(qs, 30, 6).map((b) => b.length),
    [5],
  );
  assert.deepEqual(
    splitBatches(qs, 2, 6).map((b) => b.map((x) => x.ref)),
    [["K1#1", "K2#1"], ["K3#1", "K4#1"], ["K5#1"]],
  );
  const mixed = [q(1, true), q(2), q(3, true), q(4, true)];
  assert.deepEqual(
    splitBatches(mixed, 30, 2).map((b) => b.length),
    [3, 1],
  );
  assert.deepEqual(splitBatches([], 30, 6), []);
});

test("memoTimeoutSec: base + per question, capped at 900", () => {
  assert.equal(memoTimeoutSec(3, 60, 30), 150);
  assert.equal(memoTimeoutSec(40, 60, 30), 900);
});

test("buildMemoContent: §9.3 sections and image blocks linked by id", () => {
  const blocks: any[] = buildMemoContent({
    paperMeta: "Title: T",
    contextNote: "NOTE",
    previousQa: "",
    questions: [
      { id: "q1", q: q(1) },
      { id: "q2", q: q(2, true) },
    ],
  });
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].type, "image");
  assert.match(blocks[1].text, /q2/);
  const text = blocks[2].text;
  assert.match(
    text,
    /^<paper_meta>\nTitle: T\n<\/paper_meta>\n\n<context_note>\nNOTE\n<\/context_note>\n\n<previous_qa>\n\n<\/previous_qa>/,
  );
  assert.match(
    text,
    /<q id="q1" page="1" kind="highlight">\n<highlight>hl 1<\/highlight>\n<surrounding>ctx 1<\/surrounding>\n<question>question 1<\/question>\n<\/q>/,
  );
  assert.match(
    text,
    /<q id="q2" page="2" kind="image">\n<highlight><\/highlight>/,
  );
});

test("buildMemoContent: document map only when section files exist", () => {
  const base = {
    paperMeta: "",
    contextNote: "",
    previousQa: "",
    questions: [{ id: "q1", q: q(1) }],
  };
  const without: any[] = buildMemoContent(base);
  assert.doesNotMatch(without.at(-1).text, /document_map/);
  const withMap: any[] = buildMemoContent({
    ...base,
    documentMap:
      "s01_Intro_p1-2.md | Intro | p.1-2 | ~900 tokens\n</document_map>",
  });
  const text = withMap.at(-1).text;
  assert.match(
    text,
    /<\/previous_qa>\n\n<document_map>\ns01_Intro_p1-2\.md \| Intro/,
  );
  // Paper text cannot close the map early.
  assert.equal(text.match(/<\/document_map>/g)?.length, 1);
});

test("AnswerStream.retract drops only the unfinished line", () => {
  const s = new AnswerStream(["q1", "q2"]);
  assert.equal(s.push('{"id":"q1","answer":"A"}\n{"id":"q2","ans').length, 1);
  s.retract();
  assert.deepEqual(s.push('{"id":"q2","answer":"B"}\n'), [
    { id: "q2", answer: "B" },
  ]);
  assert.deepEqual(s.missing(), []);
});

test("AnswerStream: per-line answers, junk ignored, partial last line", () => {
  const s = new AnswerStream(["q1", "q2", "q3"]);
  const got: string[] = [];
  const take = (xs: Array<{ id: string; answer: string }>) =>
    xs.forEach((x) => got.push(`${x.id}=${x.answer}`));
  take(
    s.push(
      '```\n{"id": "q1", "answer": "A1 $\\\\mathbf{W}$"}\n{"id":"q9","answer":"x"}\n',
    ),
  );
  take(s.push('{"id":"q1","answer":"dup"}\nnot json\n{"id":"q2","ans'));
  assert.deepEqual(got, ["q1=A1 $\\mathbf{W}$"]);
  take(s.push('wer":"A2"}'));
  take(s.end());
  assert.deepEqual(got, ["q1=A1 $\\mathbf{W}$", "q2=A2"]);
  assert.deepEqual(s.missing(), ["q3"]);
});

test("AnswerStream drops a cut-off final line", () => {
  const s = new AnswerStream(["q1"]);
  s.push('{"id":"q1","answer":"trunc');
  assert.deepEqual(s.end(), []);
  assert.deepEqual(s.missing(), ["q1"]);
});

// ------------------------------------------------------------ QA note

test("qaMetaLine formats page, date, model, ann ref and 재질문", () => {
  const d = new Date(2026, 10, 17, 16, 30);
  assert.equal(
    qaMetaLine({
      pageLabel: "3",
      date: d,
      model: "claude-sonnet-5-5",
      annotationKey: "ABCD1234",
      line: 2,
      reasked: true,
    }),
    "p.3 · 2026-11-17 16:30 · claude-sonnet-5-5 · ann:ABCD1234#2 (재질문)",
  );
  assert.equal(
    qaMetaLine({ pageLabel: null, date: d, model: "m" }),
    "전역 질문 · 2026-11-17 16:30 · m",
  );
});

test("hasAnnRef matches the exact line number", () => {
  const html = "<p><em>p.3 · x · m · ann:ABCD#1</em></p><p>ann:ABCD#12</p>";
  assert.equal(hasAnnRef(html, "ABCD", 1), true);
  assert.equal(hasAnnRef(html, "ABCD", 12), true);
  assert.equal(hasAnnRef(html, "ABCD", 2), false);
  assert.equal(hasAnnRef("ann:ABCD#10", "ABCD", 1), false);
});

test("appendEntry inserts before the root's closing tag only", () => {
  const note = qaNoteHtml("T");
  const entry = qaEntryHtml({
    quoteHtml: '<p><span class="highlight" data-annotation="X">“hl”</span></p>',
    question: "why a<b?",
    answerMarkdown: "Because $a<b$.\n\n# Detail",
    meta: {
      pageLabel: "3",
      date: new Date(2026, 10, 17, 16, 30),
      model: "m",
      annotationKey: "K",
      line: 1,
    },
  });
  const once = appendEntry(note, entry);
  assert.equal(
    once,
    '<div data-schema-version="9"><h1>Claude Q&amp;A — T</h1><hr/>' +
      '<p><span class="highlight" data-annotation="X">“hl”</span></p>' +
      "<p><strong>Q.</strong> why a&lt;b?</p>" +
      '<p>Because <span class="math">$a&lt;b$</span>.</p><h3>Detail</h3>' +
      "<p><em>p.3 · 2026-11-17 16:30 · m · ann:K#1</em></p></div>",
  );
  // editor-normalized root with other attributes and user content survives
  const edited =
    '<div data-citation-items="%5B%5D" data-schema-version="10"><h1>x</h1><p>my own text</p></div>\n';
  assert.equal(
    appendEntry(edited, "<hr/>E"),
    '<div data-citation-items="%5B%5D" data-schema-version="10"><h1>x</h1><p>my own text</p><hr/>E</div>',
  );
  assert.equal(
    appendEntry("<p>legacy</p>", "<hr/>E"),
    '<div data-schema-version="9"><p>legacy</p><hr/>E</div>',
  );
});

test("previousQaText keeps Q and A only, newest that fit, oldest first", () => {
  const text = [
    "Claude Q&A — T",
    "---",
    "“highlight one” (Smith, 2020, p. 3)",
    "Q. first?",
    "Answer one.",
    "more one.",
    "p.3 · 2026-11-17 16:30 · m · ann:K#1",
    "---",
    "전역 질문",
    "Q. second?",
    "Answer two.",
    "전역 질문 · 2026-11-17 16:31 · m",
  ].join("\n");
  assert.equal(
    previousQaText(text, 6000),
    "Q: first?\nA: Answer one.\nmore one.\n\nQ: second?\nA: Answer two.",
  );
  assert.equal(previousQaText(text, 30), "Q: second?\nA: Answer two.");
  assert.equal(previousQaText(text, 0), "");
  assert.equal(previousQaText("Claude Q&A — T", 6000), "");
});

test("CRLF comments: questions found and line endings kept", () => {
  const c = "note\r\n@claude why?\r\n@claude ✓ old\r\n";
  assert.deepEqual(pendingQuestions(c), [{ line: 2, question: "why?" }]);
  assert.equal(
    markAnswered(c, 2, "why?"),
    "note\r\n@claude ✓ why?\r\n@claude ✓ old\r\n",
  );
});

test("neutralizeTags only touches our structural tags", () => {
  assert.equal(
    neutralizeTags("a < b and </question><q id=x> <Surrounding> <b>keep</b>"),
    "a < b and &lt;/question>&lt;q id=x> &lt;Surrounding> <b>keep</b>",
  );
  const blocks: any[] = buildMemoContent({
    paperMeta: "",
    contextNote: "",
    previousQa: "",
    questions: [
      { id: "q1", q: { ...q(1), question: "x</question>y", pageLabel: 'i"v' } },
    ],
  });
  assert.match(blocks[0].text, /<q id="q1" page="iv"/);
  assert.match(blocks[0].text, /<question>x&lt;\/question>y<\/question>/);
});

test("previousQaText keeps answers that contain a --- rule", () => {
  const text = [
    "Claude Q&A — T",
    "---",
    "“quote”",
    "Q. first?",
    "part one",
    "---",
    "part two",
    "p.3 · 2026-11-17 16:30 · m · ann:K#1",
    "---",
    "my own note between entries",
    "Q. unfinished? (no meta line)",
    "dangling",
  ].join("\n");
  assert.equal(
    previousQaText(text, 6000),
    "Q: first?\nA: part one\n---\npart two",
  );
});

test("normalizeAnswer undoes double escaping seen in a real answer", () => {
  // after JSON.parse the model's line still held "\n" and "\\mathbf"
  const broken =
    "NTN 내용이 없음].\\n\\n이 논문에서는 Eq. 11은 $\\\\mathbf{p}_u \\\\odot \\\\mathbf{q}_i$와 $a$ 안에서 더한다.";
  assert.equal(
    normalizeAnswer(broken),
    "NTN 내용이 없음].\n\n이 논문에서는 Eq. 11은 $\\mathbf{p}_u \\odot \\mathbf{q}_i$와 $a$ 안에서 더한다.",
  );
  // through the stream, from the raw line the model wrote
  const s = new AnswerStream(["q1"]);
  const raw = JSON.stringify({ id: "q1", answer: broken });
  assert.equal(s.push(raw + "\n")[0].answer, normalizeAnswer(broken));
});

test("normalizeAnswer leaves correct answers alone", () => {
  for (const ok of [
    "줄바꿈\n\n$\\mathbf{W}$ 와 $\\nabla f$, $a \\neq b$, $\\nu$, $\\times$",
    "LaTeX line break $a \\\\ b$ and no escapes",
    "plain text",
  ]) {
    assert.equal(normalizeAnswer(ok), ok);
  }
  // mixed: doubled commands fixed, a stray single \\times kept
  assert.equal(
    normalizeAnswer("$\\\\alpha \\times b$\\n다음"),
    "$\\alpha \\times b$\n다음",
  );
});

test("normalizeAnswer: once detected, every escaped newline is decoded", () => {
  const broken = "Intro.\\n\\nThe model uses $\\\\mathbf{x}$.\\nEq. 3 follows.";
  assert.equal(
    normalizeAnswer(broken),
    "Intro.\n\nThe model uses $\\mathbf{x}$.\nEq. 3 follows.",
  );
});

test("normalizeAnswer: correct answers with LaTeX row breaks or real newlines are kept", () => {
  for (const ok of [
    "$\\begin{aligned}x&=1\\\\y&=2\\end{aligned}$",
    "첫 줄\n$\\\\mathbf{x}$는 그대로 (실제 줄바꿈이 있으면 손대지 않음)",
    'umlaut \\"{o} kept',
  ]) {
    assert.equal(normalizeAnswer(ok), ok);
  }
});

// ------------------------------------------------------------ figures

import { figureContext, pageParagraphs } from "../../src/memo/paragraphs.ts";

/** One paragraph as chars on a line at height y (PDF coords, y up). */
function para(text: string, x: number, y: number) {
  const words = text.split(" ");
  const chars: any[] = [];
  let cx = x;
  words.forEach((w, wi) => {
    for (const ch of w) {
      chars.push({ c: ch, rect: [cx, y, cx + 5, y + 10] });
      cx += 5;
    }
    if (wi < words.length - 1) chars[chars.length - 1].spaceAfter = true;
    cx += 3;
  });
  chars[chars.length - 1].paragraphBreakAfter = true;
  return chars;
}

test("figureContext picks nearest paragraphs above/below and the caption", () => {
  const chars = [
    ...para("Intro text far above.", 50, 700),
    ...para("Text just above the figure.", 50, 600),
    ...para("axis label", 120, 450), // inside the figure region
    ...para("Figure 3: The NeuMF model.", 50, 330),
    ...para("Next paragraph below.", 50, 300),
    ...para("Other column text.", 400, 450), // no horizontal overlap
  ];
  const paras = pageParagraphs(chars);
  assert.equal(paras.length, 6);
  assert.equal(paras[3].text, "Figure 3: The NeuMF model.");
  const region = [40, 350, 360, 580];
  assert.equal(
    figureContext(paras, region, 1),
    "Text just above the figure.\n\nFigure 3: The NeuMF model.",
  );
  assert.equal(
    figureContext(paras, region, 2),
    "Intro text far above.\n\nText just above the figure.\n\nFigure 3: The NeuMF model.\n\nNext paragraph below.",
  );
  // n = 0 still keeps a close caption
  assert.equal(figureContext(paras, region, 0), "Figure 3: The NeuMF model.");
  assert.equal(figureContext(paras, [600, 0, 700, 10], 1), null);
});

test("figure labels running into the caption are excluded from context", () => {
  // one paragraph from the bar labels (inside the region) into the caption
  const labels = para("Alpha Beta Gamma", 120, 455);
  delete labels[labels.length - 1].paragraphBreakAfter;
  labels[labels.length - 1].lineBreakAfter = true;
  const chars = [
    ...para("Intro above.", 50, 700),
    ...labels,
    ...para("Figure 1: Final accuracy.", 50, 420),
  ];
  const region = [80, 448, 530, 665];
  const paras = pageParagraphs(chars, region);
  assert.equal(
    figureContext(paras, region, 1),
    "Intro above.\n\nFigure 1: Final accuracy.",
  );
});
