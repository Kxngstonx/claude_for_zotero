import { test } from "node:test";
import assert from "node:assert/strict";
import {
  charRangeToText,
  charsToText,
  compact,
  findText,
  sentenceContext,
  sentenceSpans,
  type PdfChar,
} from "../../src/pdf/chars.ts";

/** Builds reader-like chars: " " → spaceAfter, "|" → lineBreakAfter, "¶" → paragraphBreakAfter. */
function mk(s: string): PdfChar[] {
  const out: PdfChar[] = [];
  for (const ch of s) {
    const prev = out[out.length - 1];
    if (ch === " " && prev) prev.spaceAfter = true;
    else if (ch === "|" && prev) prev.lineBreakAfter = true;
    else if (ch === "¶" && prev) prev.paragraphBreakAfter = true;
    else out.push({ c: ch });
  }
  return out;
}

test("charsToText joins words, lines and paragraphs; offsets map chars", () => {
  const chars = mk("Fed Avg|works.¶Next");
  chars.splice(3, 0, { c: "​", ignorable: true });
  const ct = charsToText(chars);
  assert.equal(ct.text, "Fed Avg works.\nNext");
  assert.equal(ct.offsets.length, chars.length + 1);
  // "Avg" = chars 4..6 (after the ignorable at 3)
  const r = charRangeToText(ct, 4, 7);
  assert.equal(ct.text.slice(r.start, r.end).trim(), "Avg");
});

test("compact removes spacing and hyphens and splits ligatures", () => {
  assert.equal(compact("ﬁne-tun- ing  A").text, "finetuninga");
});

test("findText survives line-end hyphenation, ligatures and spacing", () => {
  const page = "We propose a data valu- ation method for ﬁne-tuning. Done.";
  const r = findText(page, "data valuation method for fine tuning");
  assert.ok(r);
  assert.equal(
    page.slice(r.start, r.end),
    "data valu- ation method for ﬁne-tuning",
  );
  assert.equal(findText(page, "not here"), null);
  assert.equal(findText(page, "  "), null);
});

test("sentenceSpans does not split after common abbreviations or initials", () => {
  const t =
    "As in Fig. 2 and Eq. 3, the loss drops (e.g. on CIFAR). J. Smith et al. agree. It works.\nNew para.";
  const s = sentenceSpans(t).map(([a, b]) => t.slice(a, b).trim());
  assert.deepEqual(s, [
    "As in Fig. 2 and Eq. 3, the loss drops (e.g. on CIFAR).",
    "J. Smith et al. agree.",
    "It works.",
    "New para.",
  ]);
});

test("sentenceSpans still ends a sentence at a lowercase single letter", () => {
  const t = "Pick the top k. Then train.";
  assert.equal(sentenceSpans(t).length, 2);
});

test("sentenceContext returns n sentences plus the partial sentence", () => {
  const t = "S1 one. S2 two. S3 has the target phrase in it. S4 four. S5 five.";
  const start = t.indexOf("target");
  const end = start + "target phrase".length;
  assert.deepEqual(sentenceContext(t, start, end, 1), {
    before: "S2 two. S3 has the",
    after: "in it. S4 four.",
  });
  assert.deepEqual(sentenceContext(t, start, end, 0), {
    before: "S3 has the",
    after: "in it.",
  });
  // more sentences requested than exist: clamps to the page
  assert.equal(sentenceContext(t, start, end, 9).before.startsWith("S1"), true);
  assert.equal(
    sentenceContext(t, start, end, 9).after.endsWith("S5 five."),
    true,
  );
});

test("sentenceContext with a target spanning sentences", () => {
  const t = "A a. B b. C c. D d.";
  const start = t.indexOf("B");
  const end = t.indexOf("C c.") + 4;
  assert.deepEqual(sentenceContext(t, start, end, 1), {
    before: "A a.",
    after: "D d.",
  });
});

test("sentenceContext at the end of the page does not return the whole page", () => {
  const t = "A a. B b. C c. ";
  assert.deepEqual(sentenceContext(t, t.length, t.length, 1), {
    before: "C c.",
    after: "",
  });
  assert.deepEqual(sentenceContext(t, t.length, t.length, 0), {
    before: "",
    after: "",
  });
});
