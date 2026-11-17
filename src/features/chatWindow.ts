// Chat window opened from the reader toolbar button (user request
// 2026-11-17): one window per paper, movable and resizable next to the PDF.
// Layout (m7): paper title; context note link and answer model; memo result
// with the Q&A note link; then the chat (shared session and history with the
// sidebar) with the pending memo questions row above the composer.

import { chatSession } from "../chat/chatSession";
import { modelLabel } from "../chat/chatView";
import { findContextNote, paperMeta, paperItem } from "../notes/contextNote";
import { shortTitle } from "../notes/contextNoteFormat";
import { findQaNote } from "../notes/qaNote";
import { getPref } from "../utils/prefs";
import {
  memoState,
  memoStatus,
  onMemoStateChange,
  summaryText,
} from "./memoState";
import { mountChat, resetChat, unmountChat } from "./sidebar/chatPanel";
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

function openNote(note: Zotero.Item | null) {
  // The chat window can outlive the main window (macOS).
  const pane = Zotero.getMainWindow()?.ZoteroPane;
  if (note && pane) pane.openNoteWindow(note.id);
}

/** Memo line: running progress, last result, or a hint. */
function memoLine(item: Zotero.Item): { text: string; tone: string } {
  const m = memoStatus(item);
  const st = memoState(item.id);
  if (m.running) {
    return {
      text: `메모 질문 답변 중 ${m.progress}${m.stage ? ` · ${m.stage}` : ""}`,
      tone: "run",
    };
  }
  if (st.error) return { text: summaryText(st), tone: "err" };
  const r = st.result;
  if (r?.total) {
    return r.failures.length || r.warnings.length
      ? { text: summaryText(st), tone: "warn" }
      : { text: `✓ 메모 질문 ${r.answered}개에 답했습니다`, tone: "ok" };
  }
  if (r) return { text: summaryText(st), tone: "" };
  return { text: "메모 질문의 답변은 질문 노트에 기록됩니다", tone: "" };
}

function renderHeader(win: Window, item: Zotero.Item) {
  const doc = win.document;
  const ctx = doc.getElementById("zca-context") as HTMLButtonElement | null;
  if (!ctx) return;
  const hasContext = !!findContextNote(item);
  ctx.disabled = !hasContext;
  ctx.title = hasContext
    ? "컨텍스트 노트 열기"
    : "컨텍스트 노트가 없습니다. 보관함에서 논문을 우클릭해 생성하세요.";
  (doc.getElementById("zca-qa") as HTMLButtonElement).disabled =
    !findQaNote(item);
  const line = memoLine(item);
  const status = doc.getElementById("zca-memo-status") as HTMLElement;
  status.textContent = line.text;
  status.dataset.tone = line.tone;
}

async function renderModel(win: Window, item: Zotero.Item) {
  const h = await chatSession(item).load();
  const span = win.document.getElementById("zca-model") as HTMLElement | null;
  if (!span || win.closed) return;
  const last = [...h.messages].reverse().find((m) => m.model)?.model;
  const id = last ?? getPref("claude.modelAnswer");
  span.textContent = modelLabel(id);
  span.title = `응답 모델: ${id}`;
}

function button(doc: Document, text: string, id: string, cls = "zca-link") {
  const b = el(doc, "button", text);
  b.id = id;
  b.className = cls;
  return b;
}

function populate(win: Window, item: Zotero.Item) {
  if ((win as any)._zcaPopulated) return;
  (win as any)._zcaPopulated = true;
  const doc = win.document;
  const meta = paperMeta(item);
  doc.title = `Claude — ${shortTitle(meta.title, String(item.getField("shortTitle") || ""))}`;
  const root = doc.getElementById("root")!;
  root.replaceChildren();

  const head = el(doc, "div");
  head.className = "zca-whead";
  const title = el(
    doc,
    "div",
    meta.title || doc.title.replace(/^Claude — /, ""),
  );
  title.className = "zca-wtitle";
  title.title = meta.title;
  const sub = el(doc, "div");
  sub.className = "zca-wsub";
  const ctx = button(doc, "컨텍스트 노트", "zca-context");
  ctx.addEventListener("click", () => openNote(findContextNote(item)));
  const model = el(doc, "span");
  model.id = "zca-model";
  const spacer = el(doc, "span");
  spacer.className = "zca-spacer";
  const reset = button(doc, "새 대화", "zca-reset");
  reset.addEventListener("click", () => void resetChat(item));
  sub.append(ctx, el(doc, "span", "·", "opacity:0.5;"), model, spacer, reset);
  head.append(title, sub);

  const memoBar = el(doc, "div");
  memoBar.className = "zca-wmemo";
  const status = el(doc, "span");
  status.id = "zca-memo-status";
  const qa = button(doc, "질문 노트 열기", "zca-qa");
  qa.addEventListener("click", () => openNote(findQaNote(item)));
  memoBar.append(status, qa);

  const chat = el(doc, "div");
  chat.className = "zca-wchat";
  root.append(head, memoBar, chat);
  mountChat(chat, item.id, {
    fill: true,
    header: false,
    memoRow: true,
    resetButton: reset,
  });
  renderHeader(win, item);
  void renderModel(win, item);

  const offMemo = onMemoStateChange((id) => {
    if (id === item.id && !win.closed) renderHeader(win, item);
  });
  const offChat = chatSession(item).onChange(() => {
    if (!win.closed) void renderModel(win, item);
  });
  win.addEventListener(
    "unload",
    () => {
      offMemo();
      offChat();
      unmountChat(chat);
    },
    { once: true },
  );
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
