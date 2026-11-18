// Chat UI shared by the sidebar section and the chat window (context.md §10;
// layout reworked in m7): question/answer turns, cited pages, "질문 노트에
// 저장", streaming answer with a stop button, composer; in the chat window
// also the pending memo questions row with "답변 생성".
//
// Answers are rendered from the Markdown parser's element tree into DOM
// nodes with textContent only (no innerHTML); math is typeset as MathML by
// KaTeX (trust off, §10.2). Selecting part of an answer shows "Refer to",
// which attaches the selection as a quote to the next message.
// Styles: addon/content/chat.css (Zotero theme variables).

import { errorMessage } from "../../llm/claudeCli";
import { parseBlocks, type HNode } from "../../notes/noteHtml";
import { qaEntryHtml } from "../../notes/qaFormat";
import { appendQaEntryLocked } from "../../notes/qaNote";
import { chatSession, ChatStopped } from "../../chat/chatSession";
import { questionFor, type ChatMessage } from "../../chat/chatFormat";
import { citeSegments, placesText, sortCitations } from "../../chat/chatView";
import { memoStatus, onMemoStateChange, startMemoBatch } from "../memoState";
import { mathNode } from "../../utils/mathDom";
import { el } from "./dom";

const HTML = "http://www.w3.org/1999/xhtml";
const STYLE_ID = "zca-chat-css";

export interface MountOptions {
  /** Fill the container's height (chat window). */
  fill?: boolean;
  /** "Claude 채팅" title with "새 대화" (sidebar). Default true. */
  header?: boolean;
  /** Pending memo questions with "답변 생성" above the composer (chat window). */
  memoRow?: boolean;
  /** A "새 대화" button outside the container, disabled while streaming. */
  resetButton?: HTMLButtonElement;
}

interface ChatUi {
  streaming?: boolean;
  draft?: string;
  status?: string;
  error?: string;
  /** Information line above the composer (e.g. after /memos). */
  info?: string;
  /** Part of an answer the next message refers to ("Refer to"). */
  quote?: string;
}

interface Refs {
  opts: MountOptions;
  list: HTMLElement;
  status: HTMLElement;
  input: HTMLTextAreaElement;
  send: HTMLButtonElement;
  draftBox: HTMLElement;
  draftText: HTMLElement;
  draftStatus: HTMLElement;
  quoteBar: HTMLElement;
  quoteText: HTMLElement;
  pendingText?: HTMLElement;
  pendingBtn?: HTMLButtonElement;
  /** Memo batch can run (cached by renderPending; streaming is checked live). */
  canRun?: boolean;
  reset?: HTMLButtonElement;
}

const uiState = new Map<number, ChatUi>();
// Mounted chat containers → paper id.
const containers = new Map<HTMLElement, number>();
// Papers whose chat session changes re-render the chat views.
const watched = new Map<number, () => void>();
let memoUnsubscribe: (() => void) | null = null;

const refsOf = (c: HTMLElement): Refs | undefined => (c as any)._zca;

/** Live containers of a paper; drops those of closed windows. */
function liveContainers(itemID: number): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const [c, id] of containers) {
    if (Cu.isDeadWrapper(c) || !c.isConnected) containers.delete(c);
    else if (id === itemID) out.push(c);
  }
  return out;
}

export function isChatStreaming(itemID: number): boolean {
  return !!uiState.get(itemID)?.streaming;
}

function ensureStyle(doc: Document) {
  if (doc.getElementById(STYLE_ID)) return;
  const link = doc.createElementNS(HTML, "link") as HTMLLinkElement;
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = `chrome://${addon.data.config.addonRef}/content/chat.css`;
  (doc.head ?? doc.documentElement)!.append(link);
}

/** Opens the paper's PDF at a page label (reuses an open reader tab). */
async function openPage(item: Zotero.Item, pageLabel: string) {
  const pdfs = item
    .getAttachments()
    .map((id) => Zotero.Items.get(id))
    .filter((a): a is Zotero.Item => !!a && a.isPDFAttachment());
  const open = (Zotero.Reader as any)._readers?.find((r: any) =>
    pdfs.some((a) => a.id === r.itemID),
  );
  const target = open?.itemID ?? pdfs[0]?.id;
  if (!target) return;
  try {
    await Zotero.Reader.open(target, { pageLabel } as any);
  } catch (e) {
    setUi(item.id, { error: `PDF를 열 수 없습니다: ${e}` });
  }
}

/** Text with location tags as small marks; page marks open the PDF there. */
function citedText(
  doc: Document,
  text: string,
  onPage?: (page: string) => void,
): Node[] {
  return citeSegments(text).map((s) => {
    if ("text" in s) return doc.createTextNode(s.text);
    const mark = el(doc, "span", s.cite);
    mark.className = "zca-cite";
    mark.title = s.title;
    if (s.page && onPage) {
      mark.dataset.page = s.page;
      const page = s.page;
      mark.addEventListener("click", () => onPage(page));
    }
    return mark;
  });
}

/**
 * A parser math node (<span class="math">$…$</span> or
 * <pre class="math">$$…$$</pre>) typeset as MathML.
 */
function mathElement(doc: Document, n: HNode): HTMLElement {
  const display = n.tag === "pre";
  const src = n.children.filter((c) => typeof c === "string").join("");
  const fence = display ? 2 : 1;
  const tex =
    src.startsWith("$".repeat(fence)) && src.endsWith("$".repeat(fence))
      ? src.slice(fence, -fence)
      : src;
  const e = el(doc, display ? "div" : "span");
  e.className = display ? "math math-display" : "math";
  e.append(mathNode(doc, tex.trim(), display));
  return e;
}

const BLOCKS = new Set([
  "p",
  "div",
  "li",
  "pre",
  "blockquote",
  "tr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

/**
 * The selected part of an answer as text: formulas as their TeX source
 * ($…$, a partly selected formula counts whole), location marks as
 * [tag], blocks on their own lines.
 */
export function selectionQuote(range: Range): string {
  const r = range.cloneRange();
  const mathOf = (n: Node) =>
    (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest("math");
  const ms = mathOf(r.startContainer);
  if (ms) r.setStartBefore(ms);
  const me = mathOf(r.endContainer);
  if (me) r.setEndAfter(me);
  let out = "";
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      out += n.nodeValue ?? "";
      return;
    }
    const e = n.nodeType === 1 ? (n as Element) : null;
    if (e?.localName === "math") {
      const tex = e.querySelector("annotation")?.textContent?.trim();
      const fence = e.getAttribute("display") === "block" ? "$$" : "$";
      out += tex ? `${fence}${tex}${fence}` : (e.textContent ?? "");
      return;
    }
    if (e?.classList.contains("zca-cite")) {
      const space = !out || /\s$/.test(out) ? "" : " ";
      out += `${space}[${e.getAttribute("title") || e.textContent}]`;
      return;
    }
    for (const c of Array.from(n.childNodes)) if (c) walk(c);
    if (e && BLOCKS.has(e.localName)) out += "\n";
  };
  walk(r.cloneContents());
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Markdown → DOM nodes from the parser's element tree (text via textContent).
 * With `onPage`, location tags in plain text become marks.
 */
export function markdownNodes(
  doc: Document,
  md: string,
  onPage?: (page: string) => void,
): Node[] {
  const build = (n: HNode | string, plain: boolean): Node | Node[] => {
    if (typeof n === "string") {
      return plain && onPage
        ? citedText(doc, n, onPage)
        : doc.createTextNode(n);
    }
    if (n.attrs?.class === "math") return mathElement(doc, n);
    const e = doc.createElementNS(HTML, n.tag) as HTMLElement;
    if (n.tag === "a" && n.attrs?.href) {
      const href = n.attrs.href;
      e.setAttribute("href", href);
      e.addEventListener("click", (ev) => {
        ev.preventDefault();
        Zotero.launchURL(href);
      });
    }
    if (n.attrs?.class) e.className = n.attrs.class;
    const inner =
      plain &&
      n.attrs?.class !== "math" &&
      !["a", "code", "pre"].includes(n.tag);
    for (const c of n.children) {
      const built = build(c, inner);
      if (Array.isArray(built)) e.append(...built);
      else e.append(built);
    }
    return e;
  };
  return parseBlocks(md, { headingShift: 2 }).flatMap((n) => build(n, true));
}

/**
 * Updates the UI state. `live` updates (streamed text, status) only touch the
 * draft and status elements; others rebuild the message list.
 */
function setUi(itemID: number, patch: Partial<ChatUi>, live = false) {
  uiState.set(itemID, { ...(uiState.get(itemID) ?? {}), ...patch });
  for (const c of liveContainers(itemID)) {
    if (live) renderLive(c, itemID);
    else void renderMessages(c, itemID);
  }
}

function renderPending(refs: Refs, item: Zotero.Item) {
  if (!refs.pendingText || !refs.pendingBtn) return;
  const m = memoStatus(item);
  refs.pendingText.textContent = m.running
    ? "메모 질문 답변 중…"
    : m.pending
      ? `메모 질문 ${m.pending}개 대기 · ${placesText(m.places)}`
      : "대기 중인 메모 질문 없음";
  refs.canRun = m.canRun;
  // Not while a chat answer is being written (user request, m7).
  refs.pendingBtn.disabled = !m.canRun || isChatStreaming(item.id);
}

function renderLive(container: HTMLElement, itemID: number) {
  const refs = refsOf(container);
  if (!refs) return;
  const st = uiState.get(itemID) ?? {};
  refs.draftBox.style.display = st.streaming ? "" : "none";
  refs.draftText.textContent = st.draft ?? "";
  refs.draftText.style.display = st.draft ? "" : "none";
  refs.draftStatus.textContent = st.status || "작성 중";
  refs.quoteBar.style.display = st.quote ? "" : "none";
  refs.quoteText.textContent = st.quote ?? "";
  refs.status.textContent = st.error ?? st.info ?? "";
  refs.status.classList.toggle("zca-error", !!st.error);
  refs.input.disabled = !!st.streaming;
  refs.send.disabled = !!st.streaming;
  if (refs.reset) refs.reset.disabled = !!st.streaming;
  // Per streamed chunk: no annotation scan, only the streaming flag.
  if (refs.pendingBtn)
    refs.pendingBtn.disabled = !refs.canRun || !!st.streaming;
  if (st.streaming) refs.list.scrollTop = refs.list.scrollHeight;
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
  const quote = q === "/memos" ? undefined : uiState.get(item.id)?.quote;
  if (q === "/memos") {
    setUi(item.id, {
      error: undefined,
      info: "메모 질문 답변을 시작했습니다. 결과는 이 대화에 표시됩니다.",
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
    info: undefined,
    quote: undefined,
  });
  try {
    await session.send(
      q,
      {
        onDelta: (t) => setUi(item.id, { draft: t }, true),
        onStatus: (s) => setUi(item.id, { status: s }, true),
      },
      quote,
    );
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

function answerView(
  doc: Document,
  item: Zotero.Item,
  m: ChatMessage,
  index: number,
): HTMLElement[] {
  const onPage = (page: string) => void openPage(item, page);
  const body = el(doc, "div");
  body.className = "zca-a";
  body.append(...markdownNodes(doc, m.text, onPage));
  if (m.model) body.title = m.model;

  const row = el(doc, "div");
  row.className = "zca-row";
  const cites = sortCitations(
    [...body.querySelectorAll(".zca-cite[data-page]")].map((e) => ({
      label: e.textContent ?? "",
      page: (e as HTMLElement).dataset.page!,
    })),
  );
  if (cites.length) {
    const label = el(doc, "span", "근거");
    label.className = "zca-label";
    row.append(label);
    for (const c of cites) {
      const chip = el(doc, "button", c.label);
      chip.className = "zca-chip";
      chip.title = `PDF ${c.label}로 이동`;
      chip.addEventListener("click", () => onPage(c.page));
      row.append(chip);
    }
  }
  const spacer = el(doc, "span");
  spacer.className = "zca-spacer";
  row.append(spacer);
  if (m.savedAt) {
    const saved = el(doc, "span", "✓ 질문 노트에 저장됨");
    saved.className = "zca-saved";
    row.append(saved);
  } else {
    const save = el(doc, "button", "질문 노트에 저장");
    save.className = "zca-link";
    save.disabled = !item.library.editable;
    save.addEventListener("click", () => {
      save.disabled = true;
      void saveToQaNote(item, index);
    });
    row.append(save);
  }
  return [body, row];
}

/** Turns: a question with its answer; notices stand alone. */
function messageViews(
  doc: Document,
  item: Zotero.Item,
  messages: ChatMessage[],
): HTMLElement[] {
  const out: HTMLElement[] = [];
  let turn: HTMLElement | null = null;
  let answered = false;
  messages.forEach((m, i) => {
    if (m.role === "notice") {
      const n = el(doc, "div", m.text);
      n.className = "zca-notice";
      out.push(n);
      turn = null;
      return;
    }
    if (m.role === "user") {
      turn = el(doc, "div");
      turn.className = "zca-turn";
      const label = el(doc, "div", "질문");
      label.className = "zca-q-label";
      turn.append(label);
      if (m.quote) {
        const quote = el(doc, "div", m.quote);
        quote.className = "zca-quote";
        turn.append(quote);
      }
      const q = el(doc, "div", m.text);
      q.className = "zca-q";
      turn.append(q);
      out.push(turn);
      answered = false;
      return;
    }
    if (!turn || answered) {
      turn = el(doc, "div");
      turn.className = "zca-turn";
      out.push(turn);
    }
    turn.append(...answerView(doc, item, m, i));
    answered = true;
  });
  return out;
}

async function renderMessages(container: HTMLElement, itemID: number) {
  const item = Zotero.Items.get(itemID);
  const refs = refsOf(container);
  if (!item || !refs) return;
  const doc = container.ownerDocument!;
  const h = await chatSession(item).load();
  const st = uiState.get(itemID) ?? {};
  const list = refs.list;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  const views = messageViews(doc, item, h.messages);
  list.replaceChildren(...views);
  // The answer being written goes under its question.
  const last = views.at(-1);
  if (!st.streaming) refs.draftBox.remove();
  else if (last && h.messages.at(-1)?.role === "user")
    last.append(refs.draftBox);
  else list.append(refs.draftBox);
  if (!h.messages.length && !st.streaming) {
    const empty = el(
      doc,
      "div",
      "논문 전체에 대한 질문을 입력하세요. Claude가 컨텍스트 노트를 보고, 필요하면 섹션 원문을 읽습니다. /memos 로 메모 질문 일괄 답변을 실행할 수 있습니다.",
    );
    empty.className = "zca-empty";
    list.append(empty);
  }
  if (atBottom || st.streaming) list.scrollTop = list.scrollHeight;
  renderPending(refs, item);
  renderLive(container, itemID);
}

export async function resetChat(item: Zotero.Item) {
  await chatSession(item).reset();
  setUi(item.id, {
    streaming: false,
    draft: "",
    status: "",
    error: undefined,
    info: undefined,
  });
}

function build(container: HTMLElement, opts: MountOptions): Refs {
  const doc = container.ownerDocument!;
  ensureStyle(doc);
  container.replaceChildren();
  container.classList.add("zca-chat");
  container.classList.toggle("zca-fill", !!opts.fill);
  const paper = () => Zotero.Items.get(Number(container.dataset.zcaPaper));

  if (opts.header !== false) {
    const header = el(doc, "div");
    header.className = "zca-chat-head";
    header.append(el(doc, "strong", "Claude 채팅"));
    const reset = el(doc, "button", "새 대화");
    reset.className = "zca-btn";
    reset.addEventListener("click", () => {
      const p = paper();
      if (p) void resetChat(p);
    });
    header.append(reset);
    container.append(header);
  }
  const resetButton =
    opts.resetButton ??
    (container.querySelector(
      ".zca-chat-head button",
    ) as HTMLButtonElement | null) ??
    undefined;

  const list = el(doc, "div");
  list.className = "zca-list";

  const draftBox = el(doc, "div");
  draftBox.style.display = "none";
  const draftText = el(doc, "div");
  draftText.className = "zca-draft-text";
  const draftRow = el(doc, "div");
  draftRow.className = "zca-row";
  const draftStatus = el(doc, "span");
  draftStatus.className = "zca-label";
  const spacer = el(doc, "span");
  spacer.className = "zca-spacer";
  const stop = el(doc, "button", "중지");
  stop.className = "zca-btn";
  stop.addEventListener("click", () => {
    const p = paper();
    if (p) chatSession(p).stop("user");
  });
  draftRow.append(draftStatus, spacer, stop);
  draftBox.append(draftText, draftRow);

  const bottom = el(doc, "div");
  bottom.className = "zca-bottom";
  const status = el(doc, "div");
  status.className = "zca-status";
  bottom.append(status);

  // The quoted part the next message refers to, with a remove button.
  const quoteBar = el(doc, "div");
  quoteBar.className = "zca-quote-bar";
  quoteBar.style.display = "none";
  const quoteText = el(doc, "div");
  quoteText.className = "zca-quote";
  const unquote = el(doc, "button", "×");
  unquote.className = "zca-link";
  unquote.title = "인용 빼기";
  unquote.addEventListener("click", () => {
    const p = paper();
    if (p) setUi(p.id, { quote: undefined }, true);
  });
  quoteBar.append(quoteText, unquote);

  const refs: Refs = {
    opts,
    list,
    status,
    input: el(doc, "textarea"),
    send: el(doc, "button", "↑"),
    draftBox,
    draftText,
    draftStatus,
    quoteBar,
    quoteText,
    reset: resetButton,
  };

  if (opts.memoRow) {
    const row = el(doc, "div");
    row.className = "zca-pending";
    refs.pendingText = el(doc, "span");
    refs.pendingBtn = el(doc, "button", "답변 생성");
    refs.pendingBtn.id = "zca-memo";
    refs.pendingBtn.className = "zca-btn zca-accent";
    refs.pendingBtn.title =
      "대기 중인 메모 질문에 답하고 질문 노트에 기록합니다";
    refs.pendingBtn.addEventListener("click", () => {
      const p = paper();
      if (p && !isChatStreaming(p.id)) void startMemoBatch(p);
    });
    row.append(refs.pendingText, refs.pendingBtn);
    bottom.append(row);
  }

  const composer = el(doc, "div");
  composer.className = "zca-composer";
  const input = refs.input;
  input.rows = 2;
  input.placeholder = "이 논문에 대해 묻기 (Enter 보내기, Shift+Enter 줄바꿈)";
  const sendBtn = refs.send;
  sendBtn.className = "zca-send";
  sendBtn.title = "보내기";
  composer.append(input, sendBtn);
  bottom.append(quoteBar, composer);
  container.append(list, bottom);

  // "Refer to" above a selection inside one answer.
  const refer = el(doc, "button", "Refer to");
  refer.className = "zca-refer";
  refer.title = "선택한 부분을 다음 메시지에 인용합니다";
  refer.style.display = "none";
  container.append(refer);
  let selected: Range | null = null;
  const hideRefer = () => {
    refer.style.display = "none";
    selected = null;
  };
  const answerOf = (n: Node) =>
    (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest(".zca-a") ??
    null;
  const showRefer = () => {
    const sel = doc.defaultView?.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return hideRefer();
    const r = sel.getRangeAt(0);
    const answer = answerOf(r.startContainer);
    if (!answer || answer !== answerOf(r.endContainer)) return hideRefer();
    if (!list.contains(answer) || !selectionQuote(r)) return hideRefer();
    selected = r.cloneRange();
    refer.style.display = "";
    const box = container.getBoundingClientRect();
    const rect = r.getBoundingClientRect();
    const w = refer.offsetWidth;
    const h = refer.offsetHeight;
    const above = rect.top - box.top - h - 6;
    const top = above >= 0 ? above : rect.bottom - box.top + 6;
    const left = rect.left - box.left + rect.width / 2 - w / 2;
    refer.style.top = `${top}px`;
    refer.style.left = `${Math.max(0, Math.min(left, box.width - w))}px`;
  };
  list.addEventListener("mouseup", () =>
    doc.defaultView?.setTimeout(showRefer, 0),
  );
  list.addEventListener("mousedown", hideRefer);
  list.addEventListener("scroll", hideRefer);
  // Keep the selection while the button is pressed.
  refer.addEventListener("mousedown", (ev) => ev.preventDefault());
  refer.addEventListener("click", () => {
    const p = paper();
    const quote = selected ? selectionQuote(selected) : "";
    hideRefer();
    doc.defaultView?.getSelection()?.removeAllRanges();
    if (!p || !quote) return;
    setUi(p.id, { quote }, true);
    input.focus();
  });

  const grow = () => {
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  };
  const submit = () => {
    const p = paper();
    if (!p || isChatStreaming(p.id)) return;
    const text = input.value;
    input.value = "";
    grow();
    void send(p, text);
  };
  sendBtn.addEventListener("click", submit);
  input.addEventListener("input", grow);
  input.addEventListener("keydown", (ev: KeyboardEvent) => {
    // Enter sends; Shift+Enter is a newline; IME composition (Korean) is left alone.
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      submit();
    }
  });
  return refs;
}

/** Mounts (or re-binds) the chat UI in `container` for the paper. */
export function mountChat(
  container: HTMLElement,
  itemID: number,
  opts: MountOptions = {},
) {
  const item = Zotero.Items.get(itemID);
  if (!item) return;
  // Re-render on history changes from anywhere (notices, other views).
  if (!watched.has(itemID)) {
    watched.set(
      itemID,
      chatSession(item).onChange(() => setUi(itemID, {})),
    );
  }
  memoUnsubscribe ??= onMemoStateChange((id) => {
    const it = Zotero.Items.get(id);
    if (!it) return;
    for (const c of liveContainers(id)) {
      const refs = refsOf(c);
      if (refs) renderPending(refs, it);
    }
  });
  if (Number(container.dataset.zcaPaper) !== itemID) {
    container.dataset.zcaPaper = String(itemID);
    (container as any)._zca = build(container, opts);
  }
  const bound = containers.get(container) === itemID;
  containers.set(container, itemID);
  if (!bound) void renderMessages(container, itemID);
}

/** Forgets a container (its window is closing). */
export function unmountChat(container: HTMLElement) {
  containers.delete(container);
}

export function unmountChats() {
  containers.clear();
  for (const off of watched.values()) off();
  watched.clear();
  memoUnsubscribe?.();
  memoUnsubscribe = null;
  for (const win of Zotero.getMainWindows()) {
    win.document.getElementById(STYLE_ID)?.remove();
  }
}
