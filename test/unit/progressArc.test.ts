import { test } from "node:test";
import assert from "node:assert/strict";
import { arcDataUri, arcSvg } from "../../src/utils/progressArc.ts";

test("arcSvg draws the share of the ring for the percentage", () => {
  const dash = (p: number) =>
    Number(arcSvg(p).match(/stroke-dasharray="([\d.]+) /)![1]);
  const c = 2 * Math.PI * 6;
  assert.equal(dash(0), 0);
  assert.ok(Math.abs(dash(50) - c / 2) < 0.01);
  assert.ok(Math.abs(dash(150) - c) < 0.01); // clamped
  assert.match(arcSvg(40), /viewBox="0 0 16 16"/);
});

test("arcDataUri is a URL-encoded SVG", () => {
  const uri = arcDataUri(30);
  assert.ok(uri.startsWith("data:image/svg+xml,%3Csvg"));
  assert.ok(!/[<>"#]/.test(uri.slice("data:image/svg+xml,".length)));
});
