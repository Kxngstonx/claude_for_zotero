// Reader toolbar button (user requests 2026-11-17): always "Claude", with
// the number of pending @claude memo questions ("Claude · 3") or the batch
// progress ("Claude · 2/5"); a click opens the paper's Claude chat window,
// where memo questions are answered (button or /memos).
// renderToolbar covers readers opened later; already-open readers get the
// button appended to ".toolbar .end" (as the Margin Notes plugin does).

import { paperItem } from "../notes/contextNote";
import { memoStatus, onMemoStateChange } from "./memoState";
import { openChatWindow } from "./chatWindow";

const CLASS = "claudeassist-memo-button";
const STYLE =
  "display:inline-flex;align-items:center;gap:4px;font:inherit;color:inherit;white-space:nowrap;min-height:26px;padding:2px 8px;margin-inline:4px;border:1px solid transparent;border-radius:6px;background:transparent;cursor:pointer;";

// Buttons live in reader content documents. They are found by querying the
// open readers and carry their paper id in data-zca-paper: object identity
// of content DOM nodes seen from the plugin is not reliable for WeakMap/WeakRef
// bookkeeping (observed on Zotero 10.0.9).
let unsubscribe: (() => void) | null = null;

function paperForReader(reader: any): Zotero.Item | null {
  const item = Zotero.Items.get(reader?.itemID);
  return item ? paperItem(item) : null;
}

function paperIdOf(button: HTMLButtonElement): number {
  return Number(button.dataset.zcaPaper) || 0;
}

function allButtons(): HTMLButtonElement[] {
  const out: HTMLButtonElement[] = [];
  for (const reader of (Zotero.Reader as any)._readers ?? []) {
    const doc: Document | undefined = reader._iframeWindow?.document;
    if (doc)
      out.push(
        ...(Array.from(
          doc.querySelectorAll(`.${CLASS}`),
        ) as HTMLButtonElement[]),
      );
  }
  return out;
}

function update(button: HTMLButtonElement) {
  const item = Zotero.Items.get(paperIdOf(button));
  if (!item) return;
  const m = memoStatus(item);
  button.disabled = false;
  button.textContent = m.running
    ? `Claude · ${m.progress}`
    : m.pending
      ? `Claude · ${m.pending}`
      : "Claude";
  button.title = m.running
    ? `메모 질문 처리 중: ${m.stage} — 클릭하면 Claude 채팅 창`
    : m.pending
      ? `Claude 채팅 창 열기 (대기 중인 @claude 메모 질문 ${m.pending}개)`
      : "Claude 채팅 창 열기";
}

function onClick(button: HTMLButtonElement) {
  const item = Zotero.Items.get(paperIdOf(button));
  if (item) openChatWindow(item);
}

function mount(reader: any, doc: Document, append?: (n: Node) => void) {
  const paper = paperForReader(reader);
  if (!paper || doc.querySelector(`.${CLASS}`)) return;
  const button = doc.createElement("button");
  button.className = CLASS;
  button.type = "button";
  button.setAttribute("style", STYLE);
  button.addEventListener("click", () => onClick(button));
  button.dataset.zcaPaper = String(paper.id);
  update(button);
  if (append) {
    append(button);
  } else {
    const target =
      doc.querySelector(".toolbar .end") || doc.querySelector(".toolbar");
    target?.append(button);
  }
}

export function refresh(itemID?: number) {
  for (const b of allButtons()) {
    if (itemID === undefined || paperIdOf(b) === itemID) update(b);
  }
}

function onRenderToolbar(event: {
  reader: any;
  doc: Document;
  append: (n: Node) => void;
}) {
  if (event.reader?.type && event.reader.type !== "pdf") return;
  mount(event.reader, event.doc, event.append);
}

export function registerMemoToolbar() {
  Zotero.Reader.registerEventListener(
    "renderToolbar",
    onRenderToolbar as any,
    addon.data.config.addonID,
  );
  // renderToolbar has already fired for readers that were open at startup.
  for (const reader of (Zotero.Reader as any)._readers ?? []) {
    void (async () => {
      try {
        if (reader._initPromise) await reader._initPromise;
        if (reader.type && reader.type !== "pdf") return;
        const doc = reader._iframeWindow?.document;
        if (doc) mount(reader, doc);
      } catch (e) {
        Zotero.debug(`[Claude Assist] toolbar mount failed: ${e}`);
      }
    })();
  }
  unsubscribe = onMemoStateChange((id) => refresh(id));
}

export function unregisterMemoToolbar() {
  unsubscribe?.();
  unsubscribe = null;
  for (const b of allButtons()) b.remove();
}
