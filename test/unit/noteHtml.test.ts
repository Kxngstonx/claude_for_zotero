import { test } from "node:test";
import assert from "node:assert/strict";
import {
  markdownToHtml,
  parseInline,
  serialize,
  wrapNote,
} from "../../src/notes/noteHtml.ts";

const md = (s: string, shift = 0) => markdownToHtml(s, { headingShift: shift });
const inline = (s: string) => serialize(parseInline(s));

test("escapes raw HTML from the model", () => {
  assert.equal(
    md('<script>alert(1)</script> & <b onclick="x">hi</b>'),
    '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b onclick="x"&gt;hi&lt;/b&gt;</p>',
  );
});

test("inline emphasis, code and nesting", () => {
  assert.equal(
    inline("**bold *it* x** and *a* `c<d`"),
    "<strong>bold <em>it</em> x</strong> and <em>a</em> <code>c&lt;d</code>",
  );
  assert.equal(inline("snake_case_name stays"), "snake_case_name stays");
  assert.equal(inline("_word_ italic"), "<em>word</em> italic");
  assert.equal(inline("2 * 3 * 4"), "2 * 3 * 4");
});

test("inline math keeps $ delimiters and is not parsed further", () => {
  assert.equal(
    inline("loss $\\mathcal{L}_{i}^*$ here"),
    'loss <span class="math">$\\mathcal{L}_{i}^*$</span> here',
  );
  assert.equal(inline("costs $5 and $10"), "costs $5 and $10");
  assert.equal(inline("\\(a<b\\)"), '<span class="math">$a&lt;b$</span>');
  assert.equal(inline("price \\$3"), "price $3");
});

test("links: only http(s) and zotero://", () => {
  assert.equal(
    inline("[x](https://a.b/c?d=1&e=2)"),
    '<a href="https://a.b/c?d=1&amp;e=2">x</a>',
  );
  assert.equal(
    inline("[x](zotero://select/library/items/ABC)"),
    '<a href="zotero://select/library/items/ABC">x</a>',
  );
  // the URL ends at the first ")" (rest stays text); the link is still rejected
  assert.equal(inline("[x](javascript:alert(1))"), "<span>x</span>)");
  assert.equal(
    inline('[x](https://a"onmouseover="y)'),
    '<a href="https://a&quot;onmouseover=&quot;y">x</a>',
  );
});

test("headings shift and cap", () => {
  assert.equal(md("# A\n## B\n###### C", 1), "<h2>A</h2><h3>B</h3><h6>C</h6>");
});

test("display math blocks: single line, multi line, \\[ \\]", () => {
  assert.equal(md("$$x^2$$"), '<pre class="math">$$x^2$$</pre>');
  assert.equal(
    md("$$\n\\sum_i a_i\n= b\n$$"),
    '<pre class="math">$$\\sum_i a_i\n= b$$</pre>',
  );
  assert.equal(md("\\[\na<b\n\\]"), '<pre class="math">$$a&lt;b$$</pre>');
});

test("paragraph lines are joined with <br>", () => {
  assert.equal(
    md("🔗 Flow\n[Gap] → [Problem]\n\nNext"),
    "<p>🔗 Flow<br/>[Gap] → [Problem]</p><p>Next</p>",
  );
});

test("nested and ordered lists with continuation lines", () => {
  assert.equal(
    md("- a\n  - b\n    more b\n- c\n\n3. x\n4. y"),
    "<ul><li>a<ul><li>b<br/>more b</li></ul></li><li>c</li></ul>" +
      '<ol start="3"><li>x</li><li>y</li></ol>',
  );
});

test("blockquote, hr, fenced code", () => {
  assert.equal(
    md("> quoted **x**\n> more\n\n---\n```py\nif a<b:\n```"),
    "<blockquote><p>quoted <strong>x</strong><br/>more</p></blockquote><hr/>" +
      "<pre><code>if a&lt;b:</code></pre>",
  );
});

test("tables with header, inline content and escaped pipes", () => {
  assert.equal(
    md("| Symbol | Meaning |\n|---|:--|\n| $w_i$ | weight \\| of i |\n| x |"),
    "<table><tbody><tr><th>Symbol</th><th>Meaning</th></tr>" +
      '<tr><td><span class="math">$w_i$</span></td><td>weight | of i</td></tr>' +
      "<tr><td>x</td><td></td></tr></tbody></table>",
  );
});

test("a list item does not swallow a following heading", () => {
  assert.equal(md("- a\n## H"), "<ul><li>a</li></ul><h2>H</h2>");
});

test("wrapNote uses schema version 9", () => {
  assert.equal(
    wrapNote("<p>x</p>"),
    '<div data-schema-version="9"><p>x</p></div>',
  );
});

test("$$…$$ followed by text is inline math, not a runaway block", () => {
  assert.equal(
    md("$$E=mc^2$$ 에서 E는 에너지다.\n\n## Next\n- item"),
    '<p><span class="math">$E=mc^2$</span> 에서 E는 에너지다.</p><h2>Next</h2><ul><li>item</li></ul>',
  );
  // unclosed $$ before a blank line stays text
  assert.equal(md("$$ a\nb\n\npara"), "<p>$$ a<br/>b</p><p>para</p>");
  assert.equal(md("\\[x\\] then"), "<p>[x] then</p>");
});

test("heading keeps a trailing # that is part of the text", () => {
  assert.equal(md("## Why C#\n### F# ##"), "<h2>Why C#</h2><h3>F#</h3>");
});

test("italic containing bold", () => {
  assert.equal(inline("*a **b** c*"), "<em>a <strong>b</strong> c</em>");
  assert.equal(inline("**a *b* c**"), "<strong>a <em>b</em> c</strong>");
});

test("thematic break ends a list; ordered list may start at 0", () => {
  assert.equal(md("- a\n* * *"), "<ul><li>a</li></ul><hr/>");
  assert.equal(
    md("0. zero\n1. one"),
    '<ol start="0"><li>zero</li><li>one</li></ol>',
  );
});
