import { test } from "node:test";
import assert from "node:assert/strict";
import { splitMath, texToMathML } from "../../src/utils/math.ts";

test("splitMath finds inline and display math", () => {
  assert.deepEqual(splitMath("출력 $f_0 (x)$가 일치한다."), [
    { type: "text", value: "출력 " },
    { type: "math", value: "f_0 (x)", display: false },
    { type: "text", value: "가 일치한다." },
  ]);
  assert.deepEqual(splitMath("식:\n$$\ny = Wx + b\n$$\n끝"), [
    { type: "text", value: "식:\n" },
    { type: "math", value: "y = Wx + b", display: true },
    { type: "text", value: "\n끝" },
  ]);
  assert.deepEqual(
    splitMath("\\(a\\) and \\[b\\]").map((s) => s.type),
    ["math", "text", "math"],
  );
});

test("splitMath leaves prices and escaped dollars alone", () => {
  for (const t of ["costs $5 and $ 10", "a \\$b$ c", "no math here"]) {
    assert.ok(
      splitMath(t).every((s) => s.type === "text"),
      t,
    );
  }
});

test("texToMathML emits MathML and survives bad TeX", () => {
  assert.match(texToMathML("f_0(x)", false), /<math[^>]*>.*<msub>/s);
  assert.match(texToMathML("x", true), /display="block"/);
  assert.match(texToMathML("\\frac{a", false), /<math|katex-error/);
});
