// Pure helpers for the `claude -p --output-format stream-json` protocol.
// No Zotero globals here: unit-tested under Node (test/unit/).
//
// Observed with claude 2.1.326 (2026-11-17):
// - text arrives as stream_event / content_block_delta / delta.type "text_delta"
//   (thinking_delta and signature_delta also appear and must be ignored)
// - failures arrive as result {subtype:"success", is_error:true, result:<msg>}
//   and the preceding assistant event carries `error: <category>`
//   (e.g. "model_not_found")

export type ClaudeErrorKind =
  | "not_found" // CLI binary missing
  | "auth" // not logged in / org not allowed
  | "limit" // usage limit / rate limit / billing
  | "model" // unknown model
  | "timeout"
  | "other";

/** Splits a byte stream into complete lines. */
export class LineBuffer {
  private buf = "";

  push(chunk: string): string[] {
    this.buf += chunk;
    const parts = this.buf.split("\n");
    this.buf = parts.pop() ?? "";
    return parts;
  }

  /** Returns the trailing partial line (if any) and clears the buffer. */
  flush(): string | null {
    const rest = this.buf;
    this.buf = "";
    return rest.length ? rest : null;
  }
}

export function parseJsonLine(line: string): any | null {
  const t = line.trim();
  if (!t.startsWith("{")) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** Text of a streamed text delta, or null for any other event. */
export function textDelta(ev: any): string | null {
  if (ev?.type !== "stream_event") return null;
  const e = ev.event;
  if (e?.type !== "content_block_delta") return null;
  if (e.delta?.type !== "text_delta") return null;
  return typeof e.delta.text === "string" ? e.delta.text : null;
}

const AUTH = new Set([
  "authentication_failed",
  "oauth_org_not_allowed",
  "account_on_hold",
]);
const LIMIT = new Set(["rate_limit", "billing_error"]);

/** Maps an assistant `error` category (and/or the result text) to a kind. */
export function classifyError(
  assistantError: string | null | undefined,
  resultText: string | null | undefined,
): ClaudeErrorKind {
  if (assistantError) {
    if (AUTH.has(assistantError)) return "auth";
    if (LIMIT.has(assistantError)) return "limit";
    if (assistantError === "model_not_found") return "model";
  }
  const t = resultText ?? "";
  if (/not logged in|\/login/i.test(t)) return "auth";
  if (/hit your .*limit|usage limit|rate limit/i.test(t)) return "limit";
  return "other";
}

/**
 * Accumulates the events of one turn. Feed every parsed event to `add`.
 */
export class TurnCollector {
  text = "";
  sessionId: string | null = null;
  /** Resolved model id from system/init (e.g. "claude-opus-5-5"). */
  model: string | null = null;
  assistantError: string | null = null;
  rateLimited = false;
  result: any | null = null;

  add(ev: any): string | null {
    if (!ev || typeof ev !== "object") return null;
    if (ev.parent_tool_use_id) return null; // sub-agent output
    switch (ev.type) {
      case "system":
        if (ev.subtype === "init") {
          if (ev.session_id) this.sessionId = ev.session_id;
          if (ev.model) this.model = String(ev.model);
        }
        return null;
      case "assistant":
        if (ev.error) this.assistantError = String(ev.error);
        return null;
      case "rate_limit_event":
        if (ev.rate_limit_info?.status === "rejected") this.rateLimited = true;
        return null;
      case "result":
        this.result = ev;
        if (!this.sessionId && ev.session_id) this.sessionId = ev.session_id;
        return null;
      default: {
        const d = textDelta(ev);
        if (d) this.text += d;
        return d;
      }
    }
  }

  /** null if the turn succeeded, otherwise the error kind and message. */
  error(): { kind: ClaudeErrorKind; message: string } | null {
    const r = this.result;
    if (!r) return null;
    if (!r.is_error && !this.assistantError) return null;
    const message =
      (typeof r.result === "string" && r.result) ||
      (Array.isArray(r.errors) && r.errors.join("\n")) ||
      this.assistantError ||
      r.subtype ||
      "Claude Code reported an error.";
    let kind = classifyError(this.assistantError, message);
    if (kind === "other" && this.rateLimited) kind = "limit";
    return { kind, message };
  }

  /** Final answer text: streamed deltas, falling back to result.result. */
  finalText(): string {
    if (this.text) return this.text;
    const r = this.result;
    return r && !r.is_error && typeof r.result === "string" ? r.result : "";
  }
}

export function userMessage(content: unknown[]): string {
  return (
    JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n"
  );
}
