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
  | "refusal" // Anthropic's safety classifier stopped the output
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
  /**
   * The safety classifier stopped the output and the CLI went on with a
   * retry; the refused output is retracted and `text` restarts with the
   * retry's output. Two paths seen with claude 2.1.327:
   * - system/model_refusal_fallback: a fallback model starts over;
   * - the message ends with stop_reason "refusal" (stream_event
   *   message_delta), a system/informational notice ("safeguards stopped
   *   the response above · continuing once with that noted") follows, and
   *   the same model continues in a new message (MineGrad, UTR, 2026-11-18;
   *   in practice the continuation said it would stop).
   * `from` and `to` are equal in the second case.
   */
  refusalFallback: { from: string; to: string } | null = null;
  /** The output was refused and no retry ran (or the retry was refused). */
  refused = false;
  /** Refusal category reported by the API ("cyber", "bio", …), if any. */
  refusalCategory: string | null = null;
  /** Read tool calls made in this turn. */
  reads = 0;

  add(ev: any): string | null {
    if (!ev || typeof ev !== "object") return null;
    if (ev.parent_tool_use_id) return null; // sub-agent output
    switch (ev.type) {
      case "system":
        if (ev.subtype === "init") {
          if (ev.session_id) this.sessionId = ev.session_id;
          if (ev.model) this.model = String(ev.model);
        } else if (ev.subtype === "model_refusal_fallback") {
          this.refusalCategory ??= ev.api_refusal_category ?? null;
          this.refusalFallback = {
            from: String(ev.original_model ?? ""),
            to: String(ev.fallback_model ?? ""),
          };
          if (ev.fallback_model) this.model = String(ev.fallback_model);
          this.text = "";
          this.refused = false; // the retry decides
        } else if (ev.subtype === "model_refusal_no_fallback") {
          this.refusalCategory ??= ev.api_refusal_category ?? null;
          this.refused = true;
        }
        return null;
      case "assistant": {
        if (ev.error) this.assistantError = String(ev.error);
        const m = ev.message;
        // The refused message of the first model may arrive after the
        // fallback started; only a refusal of the current model counts.
        const retracted =
          this.refusalFallback && m?.model === this.refusalFallback.from;
        if (m?.stop_reason === "refusal" && !retracted) {
          this.refused = true;
          this.refusalCategory ??= m.stop_details?.category ?? null;
        }
        if (Array.isArray(m?.content)) {
          for (const b of m.content) {
            if (b?.type === "tool_use" && b.name === "Read") this.reads++;
          }
        }
        return null;
      }
      case "rate_limit_event":
        if (ev.rate_limit_info?.status === "rejected") this.rateLimited = true;
        return null;
      case "result":
        this.result = ev;
        if (!this.sessionId && ev.session_id) this.sessionId = ev.session_id;
        return null;
      default: {
        const e = ev.type === "stream_event" ? ev.event : null;
        if (e?.type === "message_delta" && e.delta?.stop_reason === "refusal") {
          // Refused unless a new message follows (see refusalFallback).
          this.refused = true;
          this.refusalCategory ??= e.delta.stop_details?.category ?? null;
          const m = this.model ?? "";
          this.refusalFallback ??= { from: m, to: m };
          this.text = "";
          return null;
        }
        if (e?.type === "message_start" && this.refused) {
          this.refused = false; // the CLI continues after the refusal
          if (e.message?.model) this.model = String(e.message.model);
          return null;
        }
        // A new text block after earlier text (e.g. after a tool call):
        // keep them apart in the streamed text.
        if (
          ev.type === "stream_event" &&
          ev.event?.type === "content_block_start" &&
          ev.event.content_block?.type === "text" &&
          this.text &&
          !this.text.endsWith("\n")
        ) {
          this.text += "\n\n";
        }
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
    if (this.refused) {
      return { kind: "refusal", message: this.refusalCategory ?? "" };
    }
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

/**
 * User-facing text for a Claude error: what happened and what to do
 * (M6). The CLI's own message is kept at the end for details.
 */
export function claudeErrorText(
  kind: ClaudeErrorKind,
  message: string,
): string {
  const detail = message.trim();
  const tail = detail ? `\n(${detail})` : "";
  switch (kind) {
    case "not_found":
      return `claude CLI를 찾지 못했습니다. 설정 › Claude Assist에서 claude 경로를 입력하세요 (터미널에서 \`which claude\`로 위치 확인).${
        detail && !detail.startsWith("claude CLI를 찾지 못했습니다") ? tail : ""
      }`;
    case "auth":
      return `Claude 로그인이 필요합니다. 터미널에서 \`claude\`를 실행해 /login 한 뒤 다시 시도하세요.${tail}`;
    case "limit": {
      const reset = resetTime(detail);
      return `Claude 사용량 한도에 도달했습니다.${reset ? ` ${reset} 이후` : " 잠시 후"} 다시 시도하세요. 한도는 다른 Claude Code 작업과 함께 쓰입니다.${tail}`;
    }
    case "model":
      return `설정한 모델을 사용할 수 없습니다. 설정 › Claude Assist의 모델 이름을 확인하세요 ("Claude CLI 연결 테스트"로 사용 가능한 목록을 볼 수 있습니다).${tail}`;
    case "refusal":
      return `Anthropic 안전 필터가 출력 생성을 중간에 멈췄습니다${detail ? ` (분류: ${detail})` : ""}. 논문 내용의 일부가 위험한 내용으로 분류된 경우로, 같은 입력으로 다시 시도해도 결과가 같을 가능성이 높습니다.`;
    case "timeout":
      return `${detail || "시간 안에 끝나지 않았습니다."} (메모 질문·컨텍스트 노트의 타임아웃은 설정 › Claude Assist에서 바꿀 수 있습니다.)`;
    default:
      return `Claude 실행 중 오류가 났습니다: ${detail || "(메시지 없음)"}`;
  }
}

/** "3:45pm", "3pm (Asia/Seoul)", "Nov. 20" from "… · resets <time> · …". */
export function resetTime(message: string): string | null {
  const m = message.match(/resets?\s+([^\n·∙•|]+)/i);
  const t = m?.[1]?.trim().replace(/[.,;:]+$/, "");
  return t || null;
}
