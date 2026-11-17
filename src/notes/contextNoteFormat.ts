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
): string {
  return `<paper_meta>\n${formatPaperMeta(meta)}\n</paper_meta>\n\n<full_text>\n${fullText}\n</full_text>`;
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
  const meta = `생성: ${p.model} · ${formatDate(p.date)} · 프롬프트 ${p.promptVersion} · 본문 ${p.pageCount}쪽 (${p.source === "cache" ? "전문 캐시" : "PDF 추출"})`;
  return wrapNote(
    textElement("h1", `Claude 컨텍스트 노트 — ${p.title}`) +
      textElement("p", meta) +
      markdownToHtml(p.markdown, { headingShift: 1 }),
  );
}
