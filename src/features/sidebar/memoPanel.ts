// Sidebar section in the reader tab (context.md §10.1, stage 1): memo
// question button, progress, result summary, link to the Q&A note.

import { getLocaleID } from "../../utils/locale";
import { errorMessage } from "../../llm/claudeCli";
import { paperItem } from "../../notes/contextNote";
import {
  collectPending,
  isMemoBatchRunning,
  runMemoBatch,
  type MemoBatchResult,
} from "../memoBatch";

const HTML = "http://www.w3.org/1999/xhtml";

interface PanelState {
  stage?: string;
  done?: number;
  total?: number;
  result?: MemoBatchResult;
  error?: string;
}

// State per paper (item id), shared by every mounted panel showing it.
const states = new Map<number, PanelState>();
// Mounted panel bodies → the paper they show.
const mounted = new Map<HTMLElement, number>();
let observerID: string | null = null;

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  text?: string,
  style?: string,
): HTMLElementTagNameMap[K] {
  const e = doc.createElementNS(HTML, tag) as HTMLElementTagNameMap[K];
  if (text !== undefined) e.textContent = text;
  if (style) e.setAttribute("style", style);
  return e;
}

function rerender(itemID: number) {
  for (const [body, id] of mounted) {
    if (!body.isConnected) mounted.delete(body);
    else if (id === itemID) render(body, id);
  }
}

async function start(item: Zotero.Item) {
  // A stale panel (e.g. in another window) must not reset a running batch.
  if (isMemoBatchRunning(item)) return;
  states.set(item.id, { stage: "시작하는 중…" });
  rerender(item.id);
  const st = states.get(item.id)!;
  try {
    st.result = await runMemoBatch(item, {
      stage: (s) => {
        st.stage = s;
        rerender(item.id);
      },
      progress: (done, total) => {
        st.done = done;
        st.total = total;
        rerender(item.id);
      },
    });
  } catch (e) {
    st.error = errorMessage(e);
  }
  st.stage = undefined;
  rerender(item.id);
}

function render(body: HTMLElement, itemID: number) {
  const doc = body.ownerDocument!;
  const item = Zotero.Items.get(itemID);
  body.replaceChildren();
  if (!item) return;
  const root = el(
    doc,
    "div",
    undefined,
    "display:flex;flex-direction:column;gap:6px;padding:4px 0;",
  );
  body.append(root);

  const running = isMemoBatchRunning(item);
  const st = states.get(itemID) ?? {};
  // Scanning annotations is skipped while running (rerenders on every answer).
  const { pending, skippedImages } = running
    ? { pending: [], skippedImages: 0 }
    : collectPending(item);

  root.append(
    el(
      doc,
      "div",
      running
        ? "메모 질문을 처리하는 중입니다."
        : `대기 중인 메모 질문: ${pending.length}개${skippedImages ? ` (그림 질문 ${skippedImages}개는 아직 지원하지 않음)` : ""}`,
    ),
  );

  const button = el(doc, "button", "메모 질문 답변");
  button.disabled = running || pending.length === 0 || !item.library.editable;
  button.addEventListener("click", () => void start(item));
  root.append(button);

  if (running) {
    const line =
      st.total !== undefined
        ? `${st.done ?? 0}/${st.total} · ${st.stage ?? ""}`
        : (st.stage ?? "");
    root.append(el(doc, "div", line, "opacity:0.8;"));
    return;
  }

  if (st.error) {
    root.append(
      el(
        doc,
        "div",
        `실패: ${st.error}`,
        "color:#c0392b;white-space:pre-wrap;",
      ),
    );
  }
  const r = st.result;
  if (r) {
    root.append(
      el(
        doc,
        "div",
        r.total === 0
          ? "대기 중인 질문이 없었습니다."
          : `처리 ${r.answered}건, 실패 ${r.failures.length}건`,
      ),
    );
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

  // Refresh pending counts when annotations change.
  observerID = Zotero.Notifier.registerObserver(
    {
      notify: (_event: string, type: string, ids: Array<number | string>) => {
        if (type !== "item") return;
        const touched = new Set<number>();
        for (const id of ids) {
          const it = Zotero.Items.get(Number(id));
          const paper =
            it &&
            (it.isAnnotation() ? it.parentItem?.parentItem : paperItem(it));
          if (paper) touched.add(paper.id);
        }
        for (const id of touched)
          if (!isMemoBatchRunning(Zotero.Items.get(id) as Zotero.Item))
            rerender(id);
      },
    },
    ["item"],
    "claudeassist-memo",
  );
}

export function unregisterMemoPanel() {
  if (observerID) Zotero.Notifier.unregisterObserver(observerID);
  observerID = null;
  mounted.clear();
}
