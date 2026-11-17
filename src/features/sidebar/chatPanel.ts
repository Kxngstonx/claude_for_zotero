// Sidebar chat UI (context.md §10): messages, streaming answer, input,
// stop/new conversation, "/memos", and "질문 노트에 저장" per answer.
//
// Answers are rendered from the Markdown parser's element tree into DOM
// nodes with textContent only (no innerHTML); math stays as $…$ text (§10.2).

import { errorMessage } from "../../llm/claudeCli";
import { parseBlocks, type HNode } from "../../notes/noteHtml";
import { qaEntryHtml } from "../../notes/qaFormat";
import { appendQaEntryLocked } from "../../notes/qaNote";
import { chatSession, ChatStopped } from "../../chat/chatSession";
import { questionFor, type ChatMessage } from "../../chat/chatFormat";
import { startMemoBatch } from "../memoState";
import { el } from "./dom";

const HTML = "http://www.w3.org/1999/xhtml";

interface ChatUi {
  streaming?: boolean;
  draft?: string;
  status?: string;
  error?: string;
}

const uiState = new Map<number, ChatUi>();
// Mounted chat containers → paper id.
const containers = new Map<HTMLElement, number>();

/** Markdown → DOM nodes from the parser's element tree (text via textContent). */
export function markdownNodes(doc: Document, md: string): Node[] {
  const build = (n: HNode | string): Node => {
    if (typeof n === "string") return doc.createTextNode(n);
    const e = doc.createElementNS(HTML, n.tag) as HTMLElement;
    if (n.tag === "a" && n.attrs?.href) {
      const href = n.attrs.href;
      e.setAttribute("href", href);
      e.addEventListener("click", (ev) => {
        ev.preventDefault();
        Zotero.launchURL(href);
      });
    }
    if (n.attrs?.class === "math") {
      e.setAttribute(
        "style",
        n.tag === "pre"
          ? "font-family:monospace;white-space:pre-wrap;margin:4px 0;"
          : "font-family:monospace;",
      );
    }
    if (n.tag === "table") e.setAttribute("style", "border-collapse:collapse;");
    if (n.tag === "td" || n.tag === "th") {
      e.setAttribute("style", "border:1px solid #8884;padding:2px 4px;");
    }
    for (const c of n.children) e.append(build(c));
    return e;
  };
  return parseBlocks(md, { headingShift: 2 }).map(build);
}

/**
 * Updates the UI state. `live` updates (streamed text, status) only touch the
 * draft and status elements; others rebuild the message list.
 */
function setUi(itemID: number, patch: Partial<ChatUi>, live = false) {
  uiState.set(itemID, { ...(uiState.get(itemID) ?? {}), ...patch });
  for (const [c, id] of containers) {
    if (!c.isConnected) containers.delete(c);
    else if (id === itemID) {
      if (live) renderLive(c, id);
      else void renderMessages(c, id);
    }
  }
}

function renderLive(container: HTMLElement, itemID: number) {
  const refs = (container as any)._zca;
  if (!refs) return;
  const st = uiState.get(itemID) ?? {};
  refs.draft.textContent = st.streaming ? (st.draft ?? "") : "";
  refs.draft.style.display = st.streaming && st.draft ? "" : "none";
  refs.status.textContent = st.error ? st.error : (st.status ?? "");
  refs.status.style.color = st.error ? "#c0392b" : "";
  refs.send.textContent = st.streaming ? "중지" : "보내기";
  refs.input.disabled = !!st.streaming;
  const list: HTMLElement = refs.list;
  if (st.streaming) list.scrollTop = list.scrollHeight;
}

async function saveToQaNote(item: Zotero.Item, index: number) {
  const session = chatSession(item);
  const h = await session.load();
  const msg = h.messages[index];
  if (!msg || msg.role !== "assistant") return;
  try {
    await appendQaEntryLocked(
      item,
      qaEntryHtml({
        quoteHtml: null,
        question: questionFor(h.messages, index),
        answerMarkdown: msg.text,
        meta: { pageLabel: null, date: new Date(), model: msg.model ?? "" },
      }),
    );
    await session.markSaved(index);
    setUi(item.id, { error: undefined });
  } catch (e) {
    setUi(item.id, { error: `질문 노트 저장 실패: ${e}` });
  }
}

async function send(item: Zotero.Item, text: string) {
  const q = text.trim();
  if (!q) return;
  if (q === "/memos") {
    setUi(item.id, {
      status: "메모 질문 처리를 시작했습니다 (툴바 버튼에 진행 상황 표시).",
      error: undefined,
    });
    void startMemoBatch(item);
    return;
  }
  const session = chatSession(item);
  setUi(item.id, {
    streaming: true,
    draft: "",
    status: "준비 중…",
    error: undefined,
  });
  try {
    await session.send(q, {
      onDelta: (t) => setUi(item.id, { draft: t }, true),
      onStatus: (s) => setUi(item.id, { status: s }, true),
    });
    setUi(item.id, { streaming: false, draft: "", status: "" });
  } catch (e) {
    setUi(item.id, {
      streaming: false,
      draft: "",
      status: "",
      error: e instanceof ChatStopped ? e.message : errorMessage(e),
    });
  }
}

function messageView(
  doc: Document,
  item: Zotero.Item,
  m: ChatMessage,
  index: number,
): HTMLElement {
  if (m.role === "notice") {
    return el(
      doc,
      "div",
      m.text,
      "font-style:italic;opacity:0.7;font-size:0.9em;",
    );
  }
  const box = el(
    doc,
    "div",
    undefined,
    m.role === "user"
      ? "align-self:flex-end;max-width:90%;background:#8882;border-radius:8px;padding:4px 8px;white-space:pre-wrap;"
      : "padding:2px 0;",
  );
  if (m.role === "user") {
    box.textContent = m.text;
    return box;
  }
  box.append(...markdownNodes(doc, m.text));
  const footer = el(
    doc,
    "div",
    undefined,
    "display:flex;gap:6px;align-items:center;",
  );
  const save = el(
    doc,
    "button",
    m.savedAt ? "질문 노트에 저장됨" : "질문 노트에 저장",
  );
  save.disabled = !!m.savedAt || !item.library.editable;
  save.addEventListener("click", () => {
    save.disabled = true;
    void saveToQaNote(item, index);
  });
  footer.append(save);
  if (m.model)
    footer.append(el(doc, "span", m.model, "font-size:0.8em;opacity:0.6;"));
  box.append(footer);
  return box;
}

async function renderMessages(container: HTMLElement, itemID: number) {
  const item = Zotero.Items.get(itemID);
  const refs = (container as any)._zca;
  if (!item || !refs) return;
  const doc = container.ownerDocument!;
  const h = await chatSession(item).load();
  const st = uiState.get(itemID) ?? {};
  const list: HTMLElement = refs.list;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.replaceChildren(
    ...h.messages.map((m, i) => messageView(doc, item, m, i)),
    refs.draft,
  );
  if (!h.messages.length && !st.streaming) {
    list.append(
      el(
        doc,
        "div",
        "논문 전체에 대한 질문을 입력하세요. Claude가 컨텍스트 노트를 보고, 필요하면 섹션 원문을 읽습니다. /memos 로 메모 질문 일괄 답변을 실행할 수 있습니다.",
        "opacity:0.7;font-size:0.9em;",
      ),
    );
  }
  if (atBottom || st.streaming) list.scrollTop = list.scrollHeight;
  renderLive(container, itemID);
}

/** Mounts (or re-binds) the chat UI in `container` for the paper. */
export function mountChat(container: HTMLElement, itemID: number) {
  const item = Zotero.Items.get(itemID);
  if (!item) return;
  if (Number(container.dataset.zcaPaper) !== itemID) {
    const doc = container.ownerDocument!;
    container.dataset.zcaPaper = String(itemID);
    container.replaceChildren();
    const header = el(
      doc,
      "div",
      undefined,
      "display:flex;align-items:center;gap:6px;margin-top:8px;",
    );
    header.append(el(doc, "strong", "Claude 채팅", "flex:1;"));
    const reset = el(doc, "button", "새 대화");
    header.append(reset);
    const list = el(
      doc,
      "div",
      undefined,
      "display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow-y:auto;user-select:text;-moz-user-select:text;padding:4px 0;",
    );
    const status = el(
      doc,
      "div",
      "",
      "font-size:0.85em;opacity:0.8;white-space:pre-wrap;",
    );
    const input = el(
      doc,
      "textarea",
      undefined,
      "width:100%;box-sizing:border-box;resize:vertical;",
    );
    input.rows = 3;
    input.placeholder = "질문 (Enter 보내기, Shift+Enter 줄바꿈)";
    const sendBtn = el(doc, "button", "보내기");
    const row = el(
      doc,
      "div",
      undefined,
      "display:flex;justify-content:flex-end;",
    );
    row.append(sendBtn);
    container.append(header, list, status, input, row);
    const draft = el(
      doc,
      "div",
      "",
      "white-space:pre-wrap;opacity:0.85;display:none;",
    );
    (container as any)._zca = { list, status, input, send: sendBtn, draft };

    const submit = () => {
      const paper = Zotero.Items.get(Number(container.dataset.zcaPaper));
      if (!paper) return;
      if (uiState.get(paper.id)?.streaming) {
        chatSession(paper).stop("user");
        return;
      }
      const text = input.value;
      input.value = "";
      void send(paper, text);
    };
    sendBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (ev: KeyboardEvent) => {
      // Enter sends; Shift+Enter is a newline; IME composition (Korean) is left alone.
      if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        submit();
      }
    });
    reset.addEventListener("click", async () => {
      const paper = Zotero.Items.get(Number(container.dataset.zcaPaper));
      if (!paper) return;
      await chatSession(paper).reset();
      setUi(paper.id, {
        streaming: false,
        draft: "",
        status: "",
        error: undefined,
      });
    });
  }
  containers.set(container, itemID);
  void renderMessages(container, itemID);
}

export function unmountChats() {
  containers.clear();
}
