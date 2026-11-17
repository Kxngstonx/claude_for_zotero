// Sidebar section in the reader tab (context.md §10.1, stage 1): memo
// question button, progress, result summary, link to the Q&A note.

import { getLocaleID } from "../../utils/locale";
import { mountChat, unmountChats } from "./chatPanel";
import { el } from "./dom";
import { paperItem } from "../../notes/contextNote";
import { collectPending, isMemoBatchRunning } from "../memoBatch";
import {
  memoState,
  onMemoStateChange,
  startMemoBatch,
  summaryText,
} from "../memoState";

// Mounted panel bodies → the paper they show.
const mounted = new Map<HTMLElement, number>();
let unsubscribe: (() => void) | null = null;

function rerender(itemID: number) {
  for (const [body, id] of mounted) {
    if (!body.isConnected) mounted.delete(body);
    else if (id === itemID) render(body, id);
  }
}

/**
 * The section body holds the memo area (re-rendered on every state change)
 * and the chat area (mounted once, updated in place so typing is not lost).
 */
function parts(body: HTMLElement): { memo: HTMLElement; chat: HTMLElement } {
  const doc = body.ownerDocument!;
  let memo = body.querySelector(":scope > .zca-memo") as HTMLElement | null;
  let chat = body.querySelector(":scope > .zca-chat") as HTMLElement | null;
  if (!memo || !chat) {
    body.replaceChildren();
    memo = el(doc, "div");
    memo.className = "zca-memo";
    chat = el(doc, "div");
    chat.className = "zca-chat";
    body.append(memo, chat);
  }
  return { memo, chat };
}

function render(body: HTMLElement, itemID: number) {
  const doc = body.ownerDocument!;
  const item = Zotero.Items.get(itemID);
  if (!item) {
    body.replaceChildren();
    return;
  }
  const { memo, chat } = parts(body);
  mountChat(chat, itemID);
  memo.replaceChildren();
  const root = el(
    doc,
    "div",
    undefined,
    "display:flex;flex-direction:column;gap:6px;padding:4px 0;",
  );
  memo.append(root);

  const running = isMemoBatchRunning(item);
  const st = memoState(itemID);
  // Scanning annotations is skipped while running (rerenders on every answer).
  const { pending } = running ? { pending: [] } : collectPending(item);

  root.append(
    el(
      doc,
      "div",
      running
        ? "메모 질문을 처리하는 중입니다."
        : `대기 중인 메모 질문: ${pending.length}개`,
    ),
  );

  const button = el(doc, "button", "메모 질문 답변");
  button.disabled = running || pending.length === 0 || !item.library.editable;
  button.addEventListener("click", () => void startMemoBatch(item));
  root.append(button);

  if (running) {
    const line =
      st.total !== undefined
        ? `${st.done ?? 0}/${st.total} · ${st.stage ?? ""}`
        : (st.stage ?? "");
    root.append(el(doc, "div", line, "opacity:0.8;"));
    return;
  }

  const summary = summaryText(st);
  if (summary) {
    root.append(
      el(
        doc,
        "div",
        summary,
        st.error ? "color:#c0392b;white-space:pre-wrap;" : "",
      ),
    );
  }
  const r = st.result;
  if (r) {
    for (const [title, items] of [
      ["실패", r.failures],
      ["확인 필요", r.warnings],
    ] as const) {
      if (!items.length) continue;
      root.append(el(doc, "div", `${title}:`, "margin-top:4px;"));
      const list = el(doc, "ul", undefined, "margin:0;padding-left:18px;");
      for (const f of items) {
        list.append(
          el(
            doc,
            "li",
            `p.${f.pageLabel} “${f.question}” — ${f.reason}`,
            "white-space:pre-wrap;",
          ),
        );
      }
      root.append(list);
    }
  }
  const noteID = r?.qaNoteID;
  if (noteID) {
    const open = el(doc, "button", "질문 노트 열기");
    open.addEventListener("click", () =>
      Zotero.getMainWindow().ZoteroPane.openNoteWindow(noteID),
    );
    root.append(open);
  }
}

export function registerMemoPanel() {
  Zotero.ItemPaneManager.registerSection({
    paneID: "claudeassist-memo",
    pluginID: addon.data.config.addonID,
    header: {
      l10nID: getLocaleID("section-memo-head"),
      icon: `chrome://${addon.data.config.addonRef}/content/icons/favicon@0.5x.png`,
    },
    sidenav: {
      l10nID: getLocaleID("section-memo-sidenav"),
      icon: `chrome://${addon.data.config.addonRef}/content/icons/favicon@0.5x.png`,
    },
    onItemChange: ({ item, tabType, setEnabled }) => {
      setEnabled(tabType === "reader" && !!item && !!paperItem(item));
      return true;
    },
    onRender: ({ body, item }) => {
      const paper = item ? paperItem(item) : null;
      if (!paper) {
        body.replaceChildren();
        return;
      }
      mounted.set(body, paper.id);
      render(body, paper.id);
    },
  });

  unsubscribe = onMemoStateChange(rerender);
}

export function unregisterMemoPanel() {
  unmountChats();
  unsubscribe?.();
  unsubscribe = null;
  mounted.clear();
}
