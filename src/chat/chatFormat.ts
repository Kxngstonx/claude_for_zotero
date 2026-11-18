// Sidebar chat: history format, first-turn preamble, tool status (context.md
// §10). Pure.

import { neutralizeTags } from "../memo/batch.ts";

export interface ChatMessage {
  role: "user" | "assistant" | "notice";
  text: string;
  /** ISO time. */
  at: string;
  model?: string;
  /** User message: the part of an earlier answer it refers to ("Refer to"). */
  quote?: string;
  /** When the answer was saved to the Q&A note (ISO time). */
  savedAt?: string;
}

export interface ChatHistory {
  version: 1;
  sessionId: string | null;
  messages: ChatMessage[];
}

export function emptyHistory(): ChatHistory {
  return { version: 1, sessionId: null, messages: [] };
}

export function parseHistory(json: string | null): ChatHistory {
  try {
    const h = JSON.parse(json ?? "");
    if (h?.version === 1 && Array.isArray(h.messages)) {
      return {
        version: 1,
        sessionId: typeof h.sessionId === "string" ? h.sessionId : null,
        messages: h.messages.filter(
          (m: any) =>
            m && typeof m.text === "string" && typeof m.role === "string",
        ),
      };
    }
  } catch {
    // corrupt or missing: start over
  }
  return emptyHistory();
}

export interface Preamble {
  paperMeta: string;
  /** Empty when there is none (generation refused). */
  contextNote: string;
  documentMap: string;
  previousQa: string;
}

export const NO_CONTEXT_NOTE =
  "(none: not available for this paper; read the section files)";

/**
 * The fixed block before the first message of a session (§10.3), followed by
 * the user's first message. Sent once; later turns are plain text.
 */
export function firstTurnText(p: Preamble, userText: string): string {
  return [
    `<paper_meta>\n${p.paperMeta}\n</paper_meta>`,
    `<context_note>\n${p.contextNote.trim() ? neutralizeTags(p.contextNote) : NO_CONTEXT_NOTE}\n</context_note>`,
    `<document_map>\n${p.documentMap}\n</document_map>`,
    `<previous_qa>\n${neutralizeTags(p.previousQa)}\n</previous_qa>`,
    userText,
  ].join("\n\n");
}

/** "s03_Method_p4-6.md 읽는 중" for a Read tool call in an assistant event. */
export function toolStatus(ev: any): string | null {
  if (ev?.type !== "assistant" || ev.parent_tool_use_id) return null;
  for (const c of ev.message?.content ?? []) {
    if (c?.type === "tool_use" && c.name === "Read") {
      const path = String(c.input?.file_path ?? "");
      return `${path.split("/").pop() || "섹션"} 읽는 중…`;
    }
  }
  return null;
}

/**
 * The text sent to the model for a user message: with a quote, the quoted
 * part of an earlier answer comes first so the question can refer to it.
 */
export function withQuote(text: string, quote?: string): string {
  if (!quote?.trim()) return text;
  return `The user refers to this part of your earlier answer:\n<quote>\n${neutralizeTags(quote.trim())}\n</quote>\n\n${text}`;
}

/** The user question that an assistant message answers (for "질문 노트에 저장"). */
export function questionFor(messages: ChatMessage[], index: number): string {
  for (let i = index - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    return m.quote?.trim() ? `${m.text} (인용: "${m.quote.trim()}")` : m.text;
  }
  return "";
}
