// Reader toolbar button for memo questions, next to other plugins' toolbar
// controls (user request 2026-11-17), so the side panel need not be open.
//
// Label = what a click does:
//   "Claude 메모 N"     → answer N pending @claude questions
//   "Claude 답변 d/t"   → running (disabled; tooltip shows the stage)
//   "질문 노트"          → nothing pending: open the Q&A note
// renderToolbar covers readers opened later; already-open readers get the
// button appended to ".toolbar .end" (as the Margin Notes plugin does).

import { paperItem } from "../notes/contextNote";
import { findQaNote } from "../notes/qaNote";
import { collectPending, isMemoBatchRunning } from "./memoBatch";
import { memoState, onMemoStateChange, startMemoBatch } from "./memoState";

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
  const running = isMemoBatchRunning(item);
  if (running) {
    const st = memoState(item.id);
    button.textContent =
      st.total !== undefined
        ? `Claude 답변 ${st.done ?? 0}/${st.total}`
        : "Claude 준비 중…";
    button.title = st.stage ?? "메모 질문 처리 중";
    button.disabled = true;
    return;
  }
  const { pending } = collectPending(item);
  if (pending.length) {
    button.textContent = `Claude 메모 ${pending.length}`;
    button.title = `대기 중인 @claude 질문 ${pending.length}개에 답합니다`;
    button.disabled = !item.library.editable;
  } else if (findQaNote(item)) {
    button.textContent = "질문 노트";
    button.title = `대기 중인 질문이 없습니다. Claude 질문 노트를 엽니다`;
    button.disabled = false;
  } else {
    button.textContent = "Claude 메모";
    button.title = `대기 중인 @claude 질문이 없습니다`;
    button.disabled = true;
  }
}

function onClick(button: HTMLButtonElement) {
  const item = Zotero.Items.get(paperIdOf(button));
  if (!item || isMemoBatchRunning(item)) return;
  if (collectPending(item).pending.length) {
    void startMemoBatch(item);
    return;
  }
  const note = findQaNote(item);
  if (note) Zotero.getMainWindow().ZoteroPane.openNoteWindow(note.id);
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
