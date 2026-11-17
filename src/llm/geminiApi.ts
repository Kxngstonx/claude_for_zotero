// Pure helpers for the Gemini generateContent REST API (context.md §7).
// API key only; never the Google OAuth login (§3).

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export function generateUrl(model: string): string {
  return `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`;
}

export function modelUrl(model: string): string {
  return `${GEMINI_BASE}/models/${encodeURIComponent(model)}`;
}

export function generateBody(system: string, user: string, temperature = 0.2) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { temperature },
  };
}

export type GeminiErrorKind =
  "no_key" | "rate_limit" | "auth" | "http" | "empty";

export class GeminiError extends Error {
  kind: GeminiErrorKind;
  status: number;
  constructor(kind: GeminiErrorKind, message: string, status = 0) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

function apiMessage(body: string): string {
  try {
    return JSON.parse(body)?.error?.message || body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

/** Throws GeminiError for a non-2xx status. 429 is a normal condition (§3). */
export function checkStatus(status: number, body: string): void {
  if (status >= 200 && status < 300) return;
  const msg = apiMessage(body);
  if (status === 429) throw new GeminiError("rate_limit", msg, status);
  if (status === 400 && /api key/i.test(msg))
    throw new GeminiError("auth", msg, status);
  if (status === 401 || status === 403)
    throw new GeminiError("auth", msg, status);
  throw new GeminiError("http", msg, status);
}

/** Concatenated text of the first candidate. */
export function responseText(body: string): string {
  const json = JSON.parse(body);
  const parts = json?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts
        .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
        .join("")
    : "";
  if (!text.trim()) {
    const reason =
      json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason;
    throw new GeminiError("empty", `빈 응답${reason ? ` (${reason})` : ""}`);
  }
  return text.trim();
}

export function geminiErrorMessage(e: unknown): string {
  if (e instanceof GeminiError) {
    switch (e.kind) {
      case "no_key":
        return "Gemini API 키가 없습니다. 설정에서 입력하세요.";
      case "rate_limit":
        return "무료 티어 속도 제한입니다. 잠시 후 다시 시도하세요.";
      case "auth":
        return `API 키 오류: ${e.message}`;
      case "empty":
        return e.message;
      default:
        return `HTTP ${e.status}: ${e.message}`;
    }
  }
  return String(e);
}
