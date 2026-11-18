// Memo batch: splitting, prompt message, JSON Lines answers (context.md
// §9.2–§9.4). Pure.

import { LineBuffer, parseJsonLine } from "../llm/streamJson.ts";

export type QuestionKind = "highlight" | "underline" | "image";

export interface MemoQuestion {
  /** Stable key for this question: "<annotationKey>#<line>". */
  ref: string;
  annotationKey: string;
  attachmentID: number;
  line: number;
  question: string;
  kind: QuestionKind;
  pageLabel: string;
  pageIndex: number;
  highlight: string;
  surrounding: string;
  /** True when `surrounding` is the ±800-char fallback (§6.2). */
  approx: boolean;
  /** Image questions (M4): base64 PNG of the annotation region. */
  image?: { mediaType: string; data: string };
}

/**
 * Splits questions into calls in paper order. A new call starts only when
 * the question or image budget would be exceeded (§9.2 step 5).
 */
export function splitBatches(
  qs: MemoQuestion[],
  maxQuestions: number,
  maxImages: number,
): MemoQuestion[][] {
  const out: MemoQuestion[][] = [];
  let cur: MemoQuestion[] = [];
  let imgs = 0;
  for (const q of qs) {
    const img = q.image ? 1 : 0;
    if (
      cur.length &&
      (cur.length >= maxQuestions || imgs + img > Math.max(0, maxImages))
    ) {
      out.push(cur);
      cur = [];
      imgs = 0;
    }
    cur.push(q);
    imgs += img;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Timeout for one call: base + per question, at most 900 s (§9.4). */
export function memoTimeoutSec(
  n: number,
  baseSec: number,
  perQuestionSec: number,
): number {
  return Math.min(900, Math.max(1, baseSec) + Math.max(0, perQuestionSec) * n);
}

const STRUCTURE_TAG =
  /<(\/?)(questions|q|question|highlight|surrounding|paper_meta|context_note|previous_qa|document_map)\b/gi;

/**
 * Neutralizes our own structural tags inside user/paper text so they cannot
 * close a section early. Other text (e.g. math "a < b") is left untouched.
 */
export function neutralizeTags(s: string): string {
  return s.replace(STRUCTURE_TAG, "&lt;$1$2");
}

export interface MemoPromptInput {
  paperMeta: string;
  contextNote: string;
  previousQa: string;
  /** documentMapText of the section files the model may Read; "" if none. */
  documentMap?: string;
  /** Questions with their ids for this call ("q1", "q2", …). */
  questions: Array<{ id: string; q: MemoQuestion }>;
}

/**
 * stream-json content blocks (§9.3). Images come first, each followed by a
 * one-line text label naming its question id; then the main text block.
 */
export function buildMemoContent(input: MemoPromptInput): unknown[] {
  const blocks: unknown[] = [];
  for (const { id, q } of input.questions) {
    if (!q.image) continue;
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: q.image.mediaType,
        data: q.image.data,
      },
    });
    blocks.push({ type: "text", text: `(위 이미지는 질문 ${id}의 그림이다.)` });
  }
  const qs = input.questions
    .map(({ id, q }) =>
      [
        `<q id="${id}" page="${q.pageLabel.replace(/["<>]/g, "")}" kind="${q.kind === "image" ? "image" : "highlight"}">`,
        `<highlight>${q.kind === "image" ? "" : neutralizeTags(q.highlight)}</highlight>`,
        `<surrounding>${neutralizeTags(q.surrounding)}</surrounding>`,
        `<question>${neutralizeTags(q.question)}</question>`,
        `</q>`,
      ].join("\n"),
    )
    .join("\n");
  blocks.push({
    type: "text",
    text: [
      `<paper_meta>\n${input.paperMeta}\n</paper_meta>`,
      `<context_note>\n${neutralizeTags(input.contextNote)}\n</context_note>`,
      `<previous_qa>\n${neutralizeTags(input.previousQa)}\n</previous_qa>`,
      ...(input.documentMap
        ? [
            `<document_map>\n${neutralizeTags(input.documentMap)}\n</document_map>`,
          ]
        : []),
      `<questions>\n${qs}\n</questions>`,
    ].join("\n\n"),
  });
  return blocks;
}

// Signatures of a second escaping layer, checked only when the answer has no
// real line break (a double-escaped answer never has one).
//   strong: two backslashes before a command name ("\\mathbf")
//   weak:   backslash-n not followed by a letter ("\n\n이", "\n- ")
const STRONG = /\\\\[A-Za-z]{2,}/;
const WEAK = /\\n(?![A-Za-z])/;

/**
 * Undoes a second layer of JSON escaping that models sometimes add: after
 * JSON.parse such an answer still holds "\n" (backslash + n) for line breaks
 * and "\\mathbf" (two backslashes) for LaTeX commands. Answers with real line
 * breaks, or without these signatures, are returned unchanged.
 */
export function normalizeAnswer(answer: string): string {
  if (answer.includes("\n")) return answer;
  if (STRONG.test(answer)) {
    // In a double-escaped text a single "\n" is always an escaped newline
    // (a LaTeX \nabla would appear as "\\nabla").
    return answer.replace(/\\(\\|"|n)/g, (_, c: string) =>
      c === "n" ? "\n" : c,
    );
  }
  if (WEAK.test(answer)) {
    // No doubled commands: only newline escapes that cannot be LaTeX.
    return answer.replace(/\\n(?![A-Za-z])/g, "\n");
  }
  return answer;
}

/**
 * Parses streamed model text as JSON Lines {"id","answer"} (§9.4). Lines
 * that are not complete JSON objects for a known id are ignored; only the
 * first answer per id counts.
 */
export class AnswerStream {
  private lines = new LineBuffer();
  private seen = new Set<string>();
  private ids: Set<string>;

  constructor(ids: string[]) {
    this.ids = new Set(ids);
  }

  push(chunk: string): Array<{ id: string; answer: string }> {
    return this.lines.push(chunk).flatMap((l) => this.take(l));
  }

  /** Tries the final line in case the last newline is missing. */
  end(): Array<{ id: string; answer: string }> {
    const rest = this.lines.flush();
    return rest ? this.take(rest) : [];
  }

  /**
   * The output so far was retracted (safety-classifier stop, then a fallback
   * model starts over): drop the unfinished line. Answers already taken stay
   * taken; the fallback's answers for those ids are ignored.
   */
  retract(): void {
    this.lines.flush();
  }

  missing(): string[] {
    return [...this.ids].filter((id) => !this.seen.has(id));
  }

  private take(line: string): Array<{ id: string; answer: string }> {
    const o = parseJsonLine(line);
    if (!o || typeof o.id !== "string" || typeof o.answer !== "string")
      return [];
    if (!this.ids.has(o.id) || this.seen.has(o.id) || !o.answer.trim())
      return [];
    this.seen.add(o.id);
    return [{ id: o.id, answer: normalizeAnswer(o.answer) }];
  }
}
