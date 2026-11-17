import { getPref } from "../utils/prefs";
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
  const xhr = await Zotero.HTTP.request(method, url, {
    headers: {
      "x-goog-api-key": apiKey(),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    responseType: "text",
    successCodes: false,
    timeout: 60000,
  });
  const text = String(xhr.response ?? "");
  checkStatus(xhr.status, text);
  return text;
}

export async function geminiGenerate(
  system: string,
  user: string,
): Promise<string> {
  const model = getPref("gemini.model");
  return responseText(
    await request("POST", generateUrl(model), generateBody(system, user)),
  );
}

/** Checks the key and model with GET models/{model}. Returns the display name. */
export async function geminiTest(): Promise<string> {
  const model = getPref("gemini.model");
  const json = JSON.parse(await request("GET", modelUrl(model)));
  return `${json.displayName || model} (${json.name || model})`;
}
