// Pure pieces of the context note (context.md §8.2). No Zotero globals.

import { markdownToHtml, textElement, wrapNote } from "./noteHtml.ts"; // .ts: also imported by Node unit tests

export const CONTEXT_TAG = "claude-context";

export interface PaperMeta {
  title: string;
  authors: string[];
  year: string;
  venue: string;
}

/**
 * "context-note v1" from the "<!-- prompt-version: … -->" header. The
 * version ends at ". " (a sentence follows), a newline or "-->", so dotted
 * versions such as "v1.1" are kept.
 */
export function promptVersion(prompt: string): string {
  const m = prompt.match(/prompt-version:\s*(.+?)\s*(?:\.\s|\n|-->)/);
  return m ? m[1].trim() : "unknown";
}

export function formatPaperMeta(m: PaperMeta): string {
  return [
    `Title: ${m.title || "(unknown)"}`,
    `Authors: ${m.authors.join("; ") || "(unknown)"}`,
    `Year: ${m.year || "(unknown)"}`,
    `Venue: ${m.venue || "(unknown)"}`,
  ].join("\n");
}

/** User message for note generation: metadata + page-marked full text. */
export function contextNoteUserMessage(
  meta: PaperMeta,
  fullText: string,
  /** PDF page count when the text after the reference list was left out. */
  trimmedFrom = 0,
): string {
  const omitted = trimmedFrom
    ? `\n\n<omitted>The text after the reference list (appendix, supplementary material; the PDF has ${trimmedFrom} pages) was left out on purpose. Do not report this as truncation.</omitted>`
    : "";
  return `<paper_meta>\n${formatPaperMeta(meta)}\n</paper_meta>\n\n<full_text>\n${fullText}\n</full_text>${omitted}`;
}

export function shortTitle(title: string, short?: string): string {
  const t = (short || title || "").trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

export interface ContextNoteParts {
  title: string;
  model: string;
  date: Date;
  promptVersion: string;
  source: string;
  pageCount: number;
  /** Pages in the PDF, when more than were sent. */
  totalPages?: number;
  markdown: string;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Note HTML: title, one meta line, then the model's Markdown (headings shifted under the title). */
export function contextNoteHtml(p: ContextNoteParts): string {
  const meta = `생성: ${p.model} · ${formatDate(p.date)} · 프롬프트 ${p.promptVersion} · 본문 ${p.pageCount}쪽${p.totalPages && p.totalPages > p.pageCount ? ` / 전체 ${p.totalPages}쪽` : ""} (${p.source === "cache" ? "전문 캐시" : "PDF 추출"})`;
  return wrapNote(
    textElement("h1", `Claude 컨텍스트 노트 — ${p.title}`) +
      textElement("p", meta) +
      markdownToHtml(p.markdown, { headingShift: 1 }),
  );
}

/** Expected length of a note in characters, from the pages sent. */
export function expectedNoteChars(pageCount: number): number {
  return Math.max(12000, pageCount * 1500);
}

/**
 * Estimated progress (0–100) for the progress window's arc. Extraction is
 * 10. While the model thinks (no text yet) it creeps from 15 toward 35;
 * once text streams it follows the received share of the expected length
 * up to 92, so a longer note than expected waits there. Saving is 96.
 */
export function noteProgress(
  stage: "text" | "model" | "save",
  modelElapsedMs: number,
  received: number,
  expected: number,
): number {
  if (stage === "text") return 10;
  if (stage === "save") return 96;
  if (received <= 0) {
    return Math.round(15 + 20 * (1 - Math.exp(-modelElapsedMs / 60000)));
  }
  return Math.round(35 + 57 * Math.min(1, received / Math.max(1, expected)));
}
