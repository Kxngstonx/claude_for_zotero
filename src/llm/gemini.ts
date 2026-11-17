import { getPref } from "../utils/prefs";
import { logged } from "../log";
import {
  checkStatus,
  generateBody,
  generateUrl,
  GeminiError,
  modelUrl,
  responseText,
} from "./geminiApi";

function apiKey(): string {
  const key = (getPref("gemini.apiKey") || "").trim();
  if (!key) throw new GeminiError("no_key", "no key");
  return key;
}

async function request(method: "GET" | "POST", url: string, body?: unknown) {
  const key = apiKey();
  let xhr: any;
  try {
    xhr = await Zotero.HTTP.request(method, url, {
      headers: {
        "x-goog-api-key": key,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      responseType: "text",
      successCodes: false,
      timeout: 60000,
    });
  } catch (e: any) {
    // No HTTP status: our 60 s timeout, or offline/DNS.
    if (
      e instanceof (Zotero.HTTP as any).TimeoutException ||
      /timeout/i.test(e?.name ?? "")
    ) {
      throw new GeminiError("timeout", String(e), 0);
    }
    throw new GeminiError("http", String(e), 0);
  }
  const text = String(xhr.response ?? "");
  checkStatus(xhr.status, text);
  return text;
}

export async function geminiGenerate(
  system: string,
  user: string,
): Promise<string> {
  const model = getPref("gemini.model");
  return logged({ feature: "translate", model }, async () =>
    responseText(
      await request("POST", generateUrl(model), generateBody(system, user)),
    ),
  );
}

/** Checks the key and model with GET models/{model}. Returns the display name. */
export async function geminiTest(): Promise<string> {
  const model = getPref("gemini.model");
  const json = JSON.parse(await request("GET", modelUrl(model)));
  return `${json.displayName || model} (${json.name || model})`;
}
