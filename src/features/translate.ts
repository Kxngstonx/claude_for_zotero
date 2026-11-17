// Feature 1: context translation (context.md §7). Runs only on request:
// a "문맥 번역" button in the reader's text selection popup, or Ctrl+Shift+T
// while that popup is open.

import { KeyboardManager } from "zotero-plugin-toolkit";
import { getPref } from "../utils/prefs";
import { loadPrompt } from "../prompts";
import { geminiGenerate } from "../llm/gemini";
import { geminiErrorMessage } from "../llm/geminiApi";
import { selectionSentenceContext } from "../pdf/readerText";
import {
  buildTranslateMessage,
  translateCacheKey,
  type TranslateInput,
} from "./translateInput";

// Session cache, oldest entries evicted first. The key includes the prompt
// text so editing translate.md takes effect immediately.
const CACHE_MAX = 200;
const cache = new Map<string, string>();

function cacheSet(key: string, value: string) {
  cache.set(key, value);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

/**
 * The most recently rendered popup. Held weakly so a closed reader's
 * document can be collected; the shortcut acts on it only while it is shown
 * and its reader tab is the selected tab.
 */
let lastPopup: {
  button: WeakRef<HTMLButtonElement>;
  tabID: string;
  run: WeakRef<() => void>;
} | null = null;
// Keeps each popup's run() alive exactly as long as its button.
const runs = new WeakMap<HTMLButtonElement, () => void>();

let keyboard: KeyboardManager | null = null;

function paperTitle(reader: any): string {
  const item = Zotero.Items.get(reader?.itemID);
  if (!item) return "";
  const top = item.parentItem ?? item;
  return String(top.getField("title") || "");
}

function onRenderTextSelectionPopup(event: {
  reader: any;
  doc: Document;
  params: any;
  append: (...nodes: Node[]) => void;
}) {
  const { reader, doc, params, append } = event;
  const target: string = params?.annotation?.text || "";
  if (!target.trim()) return;
  const pageIndex: number | undefined = params.annotation.position?.pageIndex;

  const box = doc.createElement("div");
  box.style.cssText =
    "display:flex;flex-direction:column;gap:6px;max-width:420px;";
  const button = doc.createElement("button");
  button.className = "toolbar-button wide-button";
  button.textContent = "문맥 번역";
  button.title = "문맥 번역 (Ctrl+Shift+T)";
  box.append(button);

  const run = async () => {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "번역 중…";
    const n = Math.max(0, Number(getPref("translate.contextSentences")) || 0);
    const ctx = await selectionSentenceContext(reader, target, pageIndex, n);
    const input: TranslateInput = {
      title: paperTitle(reader),
      target,
      before: ctx?.before ?? "",
      after: ctx?.after ?? "",
    };
    const message = buildTranslateMessage(input);
    Zotero.debug(
      `[Claude Assist] translate input (${ctx ? "with context" : "no context"}):\n${message}`,
    );
    try {
      const system = await loadPrompt("translate.md");
      const key = system + "\u0000" + translateCacheKey(input);
      let result = cache.get(key);
      if (!result) {
        result = await geminiGenerate(system, message);
        cacheSet(key, result);
      }
      showResult(doc, box, result, !ctx);
      button.remove();
    } catch (e) {
      showError(doc, box, geminiErrorMessage(e));
      button.disabled = false;
      button.textContent = "다시 시도";
    }
  };

  const start = () => void run();
  button.addEventListener("click", start);
  runs.set(button, start);
  lastPopup = {
    button: new WeakRef(button),
    tabID: reader.tabID,
    run: new WeakRef(start),
  };
  append(box);
}

function showResult(
  doc: Document,
  box: HTMLElement,
  text: string,
  noContext: boolean,
) {
  box.querySelector(".zca-error")?.remove();
  const out = doc.createElement("div");
  out.style.cssText =
    "white-space:pre-wrap;user-select:text;-moz-user-select:text;max-height:240px;overflow:auto;line-height:1.45;padding:2px 4px;";
  out.textContent = text;
  const footer = doc.createElement("div");
  footer.style.cssText =
    "display:flex;gap:8px;align-items:center;justify-content:flex-end;";
  if (noContext) {
    const badge = doc.createElement("span");
    badge.textContent = "문맥 미포함";
    badge.title = "앞뒤 문장을 찾지 못해 선택한 텍스트만 번역했습니다.";
    badge.style.cssText = "font-size:11px;opacity:0.7;margin-right:auto;";
    footer.append(badge);
  }
  const copy = doc.createElement("button");
  copy.className = "toolbar-button wide-button";
  copy.textContent = "복사";
  copy.addEventListener("click", () => {
    Zotero.Utilities.Internal.copyTextToClipboard(text);
    copy.textContent = "복사됨";
  });
  footer.append(copy);
  box.append(out, footer);
}

function showError(doc: Document, box: HTMLElement, message: string) {
  box.querySelector(".zca-error")?.remove();
  const err = doc.createElement("div");
  err.className = "zca-error";
  err.style.cssText = "white-space:pre-wrap;font-size:12px;color:#c0392b;";
  err.textContent = message;
  box.append(err);
}

function onKey(ev: KeyboardEvent, options: { type: string }) {
  if (options.type !== "keydown") return;
  if (!(
    ev.ctrlKey &&
    ev.shiftKey &&
    !ev.metaKey &&
    !ev.altKey &&
    ev.code === "KeyT"
  ))
    return;
  const button = lastPopup?.button.deref();
  const run = lastPopup?.run.deref();
  if (!button?.isConnected || !run) return;
  const selectedTab = Zotero.getMainWindow()?.Zotero_Tabs?.selectedID;
  if (selectedTab !== lastPopup!.tabID) return;
  ev.preventDefault();
  run();
}

/**
 * Once per plugin start. The reader listener is removed automatically on
 * plugin shutdown (pluginID); the keyboard manager follows new main windows
 * itself and is cleared by unregisterTranslate().
 */
export function registerTranslate() {
  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    onRenderTextSelectionPopup,
    addon.data.config.addonID,
  );
  keyboard = new KeyboardManager(ztoolkit);
  keyboard.register(onKey);
}

export function unregisterTranslate() {
  keyboard?.unregisterAll();
  keyboard = null;
  lastPopup = null;
  cache.clear();
}
