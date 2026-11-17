// Chat window opened from the reader toolbar button (user request
// 2026-11-17): one window per paper, movable and resizable next to the PDF.
// Header: memo button with the pending count, Q&A note button, memo status;
// below, the same chat as the sidebar (shared session and history).

import { paperMeta, paperItem } from "../notes/contextNote";
import { shortTitle } from "../notes/contextNoteFormat";
import { findQaNote } from "../notes/qaNote";
import {
  memoState,
  memoStatus,
  onMemoStateChange,
  startMemoBatch,
  summaryText,
} from "./memoState";
import { mountChat } from "./sidebar/chatPanel";
import { el } from "./sidebar/dom";

function windowName(item: Zotero.Item): string {
  return `claudeassist-chat-${item.libraryID}-${item.key}`;
}

function openWindows(): Window[] {
  const out: Window[] = [];
  const e = Services.wm.getEnumerator("claudeassist:chat");
  while (e.hasMoreElements()) out.push(e.getNext() as Window);
  return out;
}

// Windows opened here, by name: a window that has not finished loading is not
// yet listed by its windowtype (a quick second click must reuse it).
const opening = new Map<string, Window>();

export function findChatWindow(item: Zotero.Item): Window | null {
  const name = windowName(item);
  const pending = opening.get(name);
  if (pending && !pending.closed) return pending;
  opening.delete(name);
  return openWindows().find((w) => w.name === name) ?? null;
}

function renderHeader(win: Window, item: Zotero.Item) {
  const doc = win.document;
  const header = doc.getElementById("zca-header");
  if (!header) return;
  const m = memoStatus(item);
  const st = memoState(item.id);
  const memoBtn = header.querySelector("#zca-memo") as HTMLButtonElement;
  memoBtn.textContent = m.running
    ? `메모 질문 답변 중 ${m.progress}`
    : `메모 질문 답변 (${m.pending})`;
  memoBtn.disabled = !m.canRun;
  const noteBtn = header.querySelector("#zca-qa") as HTMLButtonElement;
  noteBtn.disabled = !findQaNote(item);
  const status = doc.getElementById("zca-memo-status");
  if (status) {
    status.textContent = m.running
      ? m.stage
      : st.result || st.error
        ? summaryText(st)
        : "";
  }
}

function populate(win: Window, item: Zotero.Item) {
  if ((win as any)._zcaPopulated) return;
  (win as any)._zcaPopulated = true;
  const doc = win.document;
  const meta = paperMeta(item);
  doc.title = `Claude — ${shortTitle(meta.title, String(item.getField("shortTitle") || ""))}`;
  const root = doc.getElementById("root")!;
  root.replaceChildren();

  const header = el(
    doc,
    "div",
    undefined,
    "display:flex;gap:6px;align-items:center;flex-wrap:wrap;",
  );
  header.id = "zca-header";
  const title = el(
    doc,
    "strong",
    doc.title.replace(/^Claude — /, ""),
    "flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;",
  );
  title.title = meta.title;
  const memoBtn = el(doc, "button");
  memoBtn.id = "zca-memo";
  memoBtn.addEventListener("click", () => void startMemoBatch(item));
  const noteBtn = el(doc, "button", "질문 노트");
  noteBtn.id = "zca-qa";
  noteBtn.addEventListener("click", () => {
    const note = findQaNote(item);
    // The chat window can outlive the main window (macOS).
    const pane = Zotero.getMainWindow()?.ZoteroPane;
    if (note && pane) pane.openNoteWindow(note.id);
  });
  header.append(title, memoBtn, noteBtn);
  const status = el(
    doc,
    "div",
    "",
    "font-size:0.85em;opacity:0.8;white-space:pre-wrap;",
  );
  status.id = "zca-memo-status";

  const chat = el(doc, "div");
  chat.className = "zca-chat";
  root.append(header, status, chat);
  mountChat(chat, item.id, { fill: true });
  renderHeader(win, item);

  const unsubscribe = onMemoStateChange((id) => {
    if (id === item.id && !win.closed) renderHeader(win, item);
  });
  win.addEventListener("unload", () => unsubscribe(), { once: true });
}

/** Opens (or focuses) the chat window for the paper of `item`. */
export function openChatWindow(item: Zotero.Item): Window | null {
  const paper = paperItem(item);
  if (!paper) return null;
  const existing = findChatWindow(paper);
  if (existing) {
    existing.focus();
    return existing;
  }
  const win = Zotero.getMainWindow().openDialog(
    `chrome://${addon.data.config.addonRef}/content/chatWindow.xhtml`,
    windowName(paper),
    "chrome,dialog=no,resizable,centerscreen,width=520,height=760",
  ) as Window;
  opening.set(windowName(paper), win);
  win.addEventListener(
    "load",
    () => {
      try {
        populate(win, paper);
      } catch (e) {
        Zotero.logError(e as Error);
      }
    },
    { once: true },
  );
  return win;
}

export function closeChatWindows() {
  for (const w of [...openWindows(), ...opening.values()]) {
    if (!w.closed) w.close();
  }
  opening.clear();
}
