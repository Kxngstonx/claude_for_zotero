// Activity log entries (M6). Pure: unit-tested under Node.
// Metadata only — never paper text, prompts or answers.

export type LogFeature =
  "translate" | "context-note" | "memo" | "chat" | "connection-test";

export interface LogEntry {
  feature: LogFeature;
  ok: boolean;
  model?: string | null;
  /** Duration in milliseconds. */
  ms?: number;
  /** Error kind (auth, limit, timeout, …) when !ok. */
  kind?: string;
  error?: string;
  /** Small extra facts, e.g. number of questions. */
  detail?: Record<string, string | number | boolean>;
}

const MAX_ERROR = 300;

/** One JSON line with an ISO time first. */
export function formatLogLine(e: LogEntry, now = new Date()): string {
  const line: Record<string, unknown> = {
    t: now.toISOString(),
    feature: e.feature,
    ok: e.ok,
  };
  if (e.model) line.model = e.model;
  if (typeof e.ms === "number") line.ms = Math.round(e.ms);
  if (e.kind) line.kind = e.kind;
  if (e.error) {
    const msg = String(e.error).replace(/\s+/g, " ").trim();
    line.error =
      msg.length > MAX_ERROR ? `${msg.slice(0, MAX_ERROR - 1)}…` : msg;
  }
  if (e.detail && Object.keys(e.detail).length) line.detail = e.detail;
  return JSON.stringify(line) + "\n";
}

/** Rotate when the log reaches this size (bytes). */
export const LOG_MAX_BYTES = 1_000_000;
