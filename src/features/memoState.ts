// Shared memo-batch state for the sidebar section and the reader toolbar
// button: per-paper progress/result, change listeners, and an annotation
// observer that refreshes pending counts.

import { errorMessage } from "../llm/claudeCli";
import { paperItem } from "../notes/contextNote";
import {
  isMemoBatchRunning,
  runMemoBatch,
  type MemoBatchResult,
} from "./memoBatch";

export interface MemoState {
  stage?: string;
  done?: number;
  total?: number;
  result?: MemoBatchResult;
  error?: string;
}

const states = new Map<number, MemoState>();
const listeners = new Set<(itemID: number) => void>();
let observerID: string | null = null;

export function memoState(itemID: number): MemoState {
  return states.get(itemID) ?? {};
}

/** Subscribes to state changes; returns an unsubscribe function. */
export function onMemoStateChange(fn: (itemID: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed(itemID: number) {
  for (const fn of listeners) {
    try {
      fn(itemID);
    } catch (e) {
      Zotero.debug(`[Claude Assist] memo listener failed: ${e}`);
    }
  }
}

/** One-line summary of a finished batch. */
export function summaryText(st: MemoState): string {
  if (st.error) return `실패: ${st.error}`;
  const r = st.result;
  if (!r) return "";
  if (r.total === 0) return "대기 중인 질문이 없었습니다.";
  const warn = r.warnings.length ? `, 확인 필요 ${r.warnings.length}건` : "";
  return `처리 ${r.answered}건, 실패 ${r.failures.length}건${warn}`;
}

function showSummaryPopup(item: Zotero.Item, st: MemoState) {
  const r = st.result;
  const lines = [summaryText(st)];
  for (const f of [...(r?.failures ?? []), ...(r?.warnings ?? [])].slice(
    0,
    5,
  )) {
    lines.push(`p.${f.pageLabel} “${f.question.slice(0, 40)}” — ${f.reason}`);
  }
  const failed = !!st.error || !!r?.failures.length;
  new ztoolkit.ProgressWindow("Claude 메모 질문", {
    closeOnClick: true,
    closeTime: failed ? 15000 : 6000,
  })
    .createLine({ text: lines.join("\n"), type: failed ? "fail" : "success" })
    .show();
}

export async function startMemoBatch(item: Zotero.Item): Promise<void> {
  // A stale button (another window) must not reset a running batch.
  if (isMemoBatchRunning(item)) return;
  const st: MemoState = { stage: "시작하는 중…" };
  states.set(item.id, st);
  changed(item.id);
  try {
    st.result = await runMemoBatch(item, {
      stage: (s) => {
        st.stage = s;
        changed(item.id);
      },
      progress: (done, total) => {
        st.done = done;
        st.total = total;
        changed(item.id);
      },
    });
  } catch (e) {
    st.error = errorMessage(e);
  }
  st.stage = undefined;
  changed(item.id);
  showSummaryPopup(item, st);
}

/** Refreshes listeners when annotations of a paper change (pending counts). */
export function registerMemoObserver() {
  observerID = Zotero.Notifier.registerObserver(
    {
      notify: (event: string, type: string, ids: Array<number | string>) => {
        if (type !== "item") return;
        const touched = new Set<number>();
        for (const id of ids) {
          const it = Zotero.Items.get(Number(id));
          if (!it) continue;
          // Pending counts change with annotations; the toolbar label also
          // depends on whether a Q&A note exists (notes added/removed).
          // Note edits (autosave while typing) are ignored.
          const paper = it.isAnnotation()
            ? it.parentItem?.parentItem
            : it.isNote() && event !== "modify"
              ? paperItem(it)
              : null;
          if (paper) touched.add(paper.id);
        }
        for (const id of touched) {
          const it = Zotero.Items.get(id);
          if (it && !isMemoBatchRunning(it)) changed(id);
        }
      },
    },
    ["item"],
    "claudeassist-memo",
  );
}

export function unregisterMemoObserver() {
  if (observerID) Zotero.Notifier.unregisterObserver(observerID);
  observerID = null;
  listeners.clear();
}
