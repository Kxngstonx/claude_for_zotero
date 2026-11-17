// Q&A note format (context.md §8.3). Pure.
//
// Entry layout (appended in time order, never rewritten):
//   <hr/>
//   <p>{highlight + citation from Zotero, or 전역 질문}</p>
//   <p><strong>Q.</strong> {question}</p>
//   {answer as note HTML}
//   <p><em>{meta}</em></p>

import {
  markdownToHtml,
  textElement,
  wrapNote,
  escapeText,
} from "./noteHtml.ts";
import { formatDate } from "./contextNoteFormat.ts";

export const QA_TAG = "claude-qa";

export function qaNoteHtml(shortTitle: string): string {
  return wrapNote(textElement("h1", `Claude Q&A — ${shortTitle}`));
}

export interface QaMeta {
  /** Page label, or null for a global (sidebar) question. */
  pageLabel: string | null;
  date: Date;
  model: string;
  annotationKey?: string;
  line?: number;
  reasked?: boolean;
}

export function qaMetaLine(m: QaMeta): string {
  const parts = [
    m.pageLabel === null ? "전역 질문" : `p.${m.pageLabel}`,
    formatDate(m.date),
    m.model,
  ];
  if (m.annotationKey) parts.push(`ann:${m.annotationKey}#${m.line ?? 1}`);
  return parts.join(" · ") + (m.reasked ? " (재질문)" : "");
}

/** True if the note already holds an entry for this annotation line. */
export function hasAnnRef(
  noteHtml: string,
  key: string,
  line: number,
): boolean {
  const k = key.replace(/[^A-Za-z0-9]/g, "");
  return new RegExp(`ann:${k}#${line}(?!\\d)`).test(noteHtml);
}

/**
 * One entry. `quoteHtml` is trusted HTML produced by Zotero
 * (EditorInstanceUtilities.serializeAnnotations); null means a global
 * question. Question and answer come from the user/model and are escaped.
 */
export function qaEntryHtml(e: {
  quoteHtml: string | null;
  question: string;
  answerMarkdown: string;
  meta: QaMeta;
}): string {
  const quote = e.quoteHtml ?? "<p><strong>전역 질문</strong></p>";
  return (
    "<hr/>" +
    quote +
    `<p><strong>Q.</strong> ${escapeText(e.question)}</p>` +
    markdownToHtml(e.answerMarkdown, { headingShift: 2 }) +
    `<p><em>${escapeText(qaMetaLine(e.meta))}</em></p>`
  );
}

/**
 * Inserts `entryHtml` before the closing tag of the note's root
 * <div data-schema-version>. String surgery only at that point; existing
 * content is not re-serialized (§8.1, §8.3).
 */
export function appendEntry(noteHtml: string, entryHtml: string): string {
  const html = noteHtml.trimEnd();
  if (/^<div\b[^>]*data-schema-version/.test(html) && html.endsWith("</div>")) {
    return html.slice(0, -"</div>".length) + entryHtml + "</div>";
  }
  // Not wrapped (e.g. created elsewhere): wrap the old content once.
  return wrapNote(html + entryHtml);
}

const META_LINE = /^(p\.\S*|전역 질문) · .+ · /;

/**
 * Earlier Q&A as prompt text (§9.3 <previous_qa>): question and answer only,
 * the most recent entries that fit in `maxChars`, oldest first.
 * `noteText` is the note's plain text. An entry is a "Q. " line followed by
 * the answer up to its meta line; anything else (title, quotes, user text,
 * "---" rules, even inside answers) is not used as a separator.
 */
export function previousQaText(noteText: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  const lines = noteText.split("\n");
  const pairs: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("Q. ")) continue;
    const answer: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (META_LINE.test(lines[j]) || lines[j].startsWith("Q. ")) break;
      answer.push(lines[j]);
    }
    if (j < lines.length && META_LINE.test(lines[j])) {
      pairs.push(
        `Q: ${lines[i].slice(3).trim()}\nA: ${answer.join("\n").trim()}`,
      );
    }
    i = j - 1;
  }
  const picked: string[] = [];
  let used = 0;
  for (let i = pairs.length - 1; i >= 0; i--) {
    if (used + pairs[i].length > maxChars) break;
    picked.unshift(pairs[i]);
    used += pairs[i].length + 2;
  }
  return picked.join("\n\n");
}
