import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockText,
  buildSections,
  documentMapText,
  outlineStarts,
  pageSections,
  sectionFileName,
  toBlock,
  type Block,
} from "../../src/pdf/documentMap.ts";

// Shapes recorded from Zotero.SDT on test/fixtures/make-outline-pdf.py output.
const raw = (type: string, page: number, top: number, text: string) => ({
  type,
  anchor: { pageRects: [[page, 72, top - 12, 300, top]] },
  content: [{ text, anchor: { textMap: "[…]" } }],
});
const blocks: Block[] = [
  raw("heading", 0, 732, "1 Introduction"),
  raw("paragraph", 0, 702, "Federated learning trains models."),
  raw("paragraph", 0, 674, "Keyword APPLE."),
  raw("heading", 1, 732, "2 Method"),
  raw("paragraph", 1, 702, "Keyword BANANA."),
  raw("paragraph", 2, 730, "The overview continues on page three."),
  raw("heading", 2, 704, "2.1 Model"),
  raw("paragraph", 2, 674, "Keyword CHERRY."),
  raw("heading", 3, 732, "3 Experiments"),
  raw("paragraph", 3, 702, "Keyword DURIAN."),
].map(toBlock);
const outline = [
  { title: "1 Introduction", source: "native", ref: [0] },
  {
    title: "2 Method",
    target: { position: { pageIndex: 1, rect: [72, 720, 72, 720] } },
    children: [{ title: "2.1 Model", ref: [6] }],
  },
  {
    title: "3 Experiments",
    target: { position: { pageIndex: 3, rect: [72, 732, 72, 732] } },
  },
];

test("toBlock / blockText read SDT blocks without anchors", () => {
  assert.deepEqual(blocks[6], {
    type: "heading",
    page: 2,
    top: 704,
    text: "2.1 Model",
  });
  assert.equal(
    blockText({
      content: [
        { text: "a", anchor: { text: "no" } },
        { items: [{ text: "b" }] },
      ],
    }),
    "a b",
  );
});

test("outlineStarts resolves refs and page targets, all levels", () => {
  assert.deepEqual(outlineStarts(outline, blocks), [
    { title: "1 Introduction", block: 0 },
    { title: "2 Method", block: 3 },
    { title: "2.1 Model", block: 6 },
    { title: "3 Experiments", block: 8 },
  ]);
});

test("buildSections cuts at each start, nested sections split their parent", () => {
  const s = buildSections(blocks, outline);
  assert.deepEqual(
    s.map((x) => [x.file, x.pageStart, x.pageEnd]),
    [
      ["s01_1_Introduction_p1.md", 1, 1],
      ["s02_2_Method_p2-3.md", 2, 3],
      ["s03_2_1_Model_p3.md", 3, 3],
      ["s04_3_Experiments_p4.md", 4, 4],
    ],
  );
  assert.equal(
    s[1].text,
    "2 Method\n\nKeyword BANANA.\n\nThe overview continues on page three.",
  );
  assert.ok(s[2].text.includes("CHERRY") && !s[2].text.includes("overview"));
});

test("without an outline, heading blocks are used; front matter is kept", () => {
  const withFront = [
    toBlock(raw("paragraph", 0, 760, "Title and abstract.")),
    ...blocks,
  ];
  const s = buildSections(withFront, []);
  assert.equal(s[0].title, "Front matter");
  assert.equal(s[0].text, "Title and abstract.");
  assert.deepEqual(
    s.slice(1).map((x) => x.title),
    ["1 Introduction", "2 Method", "2.1 Model", "3 Experiments"],
  );
});

test("without outline or headings, one section per page", () => {
  const flat = blocks.map((b) => ({ ...b, type: "paragraph" }));
  assert.deepEqual(
    buildSections(flat, []).map((x) => x.title),
    ["Page 1", "Page 2", "Page 3", "Page 4"],
  );
  assert.deepEqual(buildSections([], outline), []);
});

test("pageSections, file names and the document map line format", () => {
  const s = pageSections(["  first page  ", "second"]);
  assert.equal(s[1].file, "s02_Page_2_p2.md");
  assert.equal(
    sectionFileName(3, "3.2 Ablation / Results!", 5, 7),
    "s03_3_2_Ablation_Results_p5-7.md",
  );
  assert.equal(
    sectionFileName(1, "방법론 개요", 2, 2),
    "s01_방법론_개요_p2.md",
  );
  assert.equal(
    documentMapText(buildSections(blocks, outline).slice(0, 2)),
    "s01_1_Introduction_p1.md | 1 Introduction | p.1 | ~17 tokens\n" +
      "s02_2_Method_p2-3.md | 2 Method | p.2-3 | ~16 tokens",
  );
});
