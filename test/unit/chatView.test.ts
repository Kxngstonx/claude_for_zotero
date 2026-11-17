import { test } from "node:test";
import assert from "node:assert/strict";
import {
  citations,
  citeSegments,
  modelLabel,
  placesText,
} from "../../src/chat/chatView.ts";

test("modelLabel shortens model ids and aliases", () => {
  assert.equal(modelLabel("claude-sonnet-4-6"), "Sonnet 4.6");
  assert.equal(modelLabel("claude-opus-5-5"), "Opus 5.5");
  assert.equal(modelLabel("claude-haiku-4-5-20251001"), "Haiku 4.5");
  assert.equal(modelLabel("sonnet"), "Sonnet");
  assert.equal(modelLabel("opus[1m]"), "Opus");
  assert.equal(modelLabel("my-custom-model"), "my-custom-model");
  assert.equal(modelLabel(""), "");
});

test("citations lists cited pages in page order, once each", () => {
  const md =
    "A [Sec 3.2, p.4]. B [Eq. 4, p.5] and [p.4]. C [Fig. 2, pp. 6-7]. " +
    "D [Interpretation]. E [a link](https://x.org) [Table 1, p. 3]";
  assert.deepEqual(citations(md), [
    { label: "p.3", page: "3" },
    { label: "p.4", page: "4" },
    { label: "p.5", page: "5" },
    { label: "p.6–7", page: "6" },
  ]);
  assert.deepEqual(citations("no tags here"), []);
});

test("citations keeps non-numeric labels after numeric ones", () => {
  assert.deepEqual(
    citations("[p.iv] [p.2]").map((c) => c.page),
    ["2", "iv"],
  );
});

test("citeSegments turns location tags into short marks", () => {
  assert.deepEqual(
    citeSegments("CTC needs it [Interpretation]. Units [Sec 3, p.4]."),
    [
      { text: "CTC needs it" },
      { cite: "해석", title: "Interpretation", page: null },
      { text: ". Units" },
      { cite: "p.4", title: "Sec 3, p.4", page: "4" },
      { text: "." },
    ],
  );
  // Not a location tag: kept as text.
  assert.deepEqual(citeSegments("x [1] y"), [{ text: "x [1] y" }]);
  // Section-only tags keep their text.
  assert.deepEqual(citeSegments("[Sec 2]"), [
    { cite: "Sec 2", title: "Sec 2", page: null },
  ]);
});

test("placesText lists pending places compactly", () => {
  assert.equal(
    placesText([
      { page: "4", image: false },
      { page: "4", image: false },
      { page: "5", image: true },
      { page: "6", image: false },
    ]),
    "p.4, p.5 그림, p.6",
  );
  assert.equal(
    placesText(
      ["1", "2", "3", "4", "5", "6"].map((page) => ({ page, image: false })),
      4,
    ),
    "p.1, p.2, p.3, p.4 외 2곳",
  );
  assert.equal(placesText([]), "");
});
