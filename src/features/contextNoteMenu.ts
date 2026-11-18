// Item context menu: "Claude 컨텍스트 노트 생성/재생성" (context.md §8.2).

import { getLocaleID } from "../utils/locale";
import { errorMessage } from "../llm/claudeCli";
import {
  findContextNote,
  isGenerating,
  paperItem,
  regenerateContextNote,
  type GenerateProgress,
} from "../notes/contextNote";
import { noteProgress } from "../notes/contextNoteFormat";
import { applyArc, fitWindow } from "../utils/progressArc";

const STAGE: Record<string, string> = {
  text: "PDF 텍스트 추출 중…",
  model: "Claude가 노트를 작성하는 중…",
  save: "노트 저장 중…",
};

async function runFor(item: Zotero.Item, win: Window) {
  const existing = findContextNote(item);
  if (existing) {
    const ok = Services.prompt.confirm(
      win as any,
      "Claude 컨텍스트 노트 재생성",
      "기존 컨텍스트 노트를 새로 생성한 내용으로 덮어씁니다. 노트를 직접 고친 내용도 사라집니다. 계속할까요?",
    );
    if (!ok) return;
  }

  // The paper title goes in the headline (one line, cropped by Zotero) and
  // the line shows only the stage, so the text rarely wraps; fitWindow
  // grows the window when it does (long error messages).
  const title = String(item.getField("title") || "");
  const popup = new ztoolkit.ProgressWindow(`Claude 컨텍스트 노트 · ${title}`, {
    closeOnClick: false,
    closeTime: -1,
  })
    // No icon type: while running, the line shows only the progress ring.
    // ztoolkit's changeLine re-applies a line's icon asynchronously
    // (updateIcons) over anything but Zotero's own sprite, so progress
    // updates go to the ItemProgress directly; only the final success/fail
    // line goes through changeLine for its icon.
    .createLine({ text: "준비 중…", progress: 5 })
    .show();
  let lineHeight = 0;
  const update = (opts: { text: string; progress: number; type?: string }) => {
    const line = (popup as any).lines?.[0];
    try {
      if (opts.type || !line) {
        popup.changeLine(opts);
      } else {
        line.setText(opts.text);
        line.setProgress(opts.progress);
        applyArc(line, opts.progress);
      }
      lineHeight = fitWindow(line, lineHeight);
    } catch (e) {
      Zotero.debug(`[Claude Assist] progress window update failed: ${e}`);
    }
  };

  // The arc fills with an estimate: a timer advances it while the model
  // thinks (no text yet), streamed text advances it after that.
  let stage: "text" | "model" | "save" = "text";
  let text = "준비 중…";
  let modelStart = 0;
  let chars = { received: 0, expected: 1 };
  let shown = 0;
  let last = 0;
  const render = () => {
    const p = noteProgress(
      stage,
      Date.now() - modelStart,
      chars.received,
      chars.expected,
    );
    shown = Math.max(shown, p); // never moves back
    update({ text, progress: shown });
  };
  const tick = win.setInterval(() => {
    if (stage === "model") render();
  }, 1000);
  const onProgress: GenerateProgress = (s, detail, c) => {
    const now = Date.now();
    // throttle repeated streaming updates, never a stage change
    if (s === stage && now - last < 500) return;
    last = now;
    if (s === "model" && stage !== "model") modelStart = now;
    stage = s;
    if (c) chars = c;
    text = `${STAGE[s]}${detail ? ` (${detail})` : ""}`;
    render();
  };

  try {
    await regenerateContextNote(item, onProgress);
    win.clearInterval(tick);
    update({
      text: "노트를 저장했습니다.",
      type: "success",
      progress: 100,
    });
    popup.startCloseTimer(5000);
  } catch (e) {
    win.clearInterval(tick);
    update({
      text: `실패: ${errorMessage(e)}`,
      type: "fail",
      progress: 100,
    });
    popup.startCloseTimer(15000);
  }
}

export function registerContextNoteMenu() {
  Zotero.MenuManager.registerMenu({
    menuID: `${addon.data.config.addonRef}-context-note`,
    pluginID: addon.data.config.addonID,
    target: "main/library/item",
    menus: [
      {
        menuType: "menuitem",
        l10nID: getLocaleID("menu-context-note"),
        onShowing: (_event: Event, ctx: any) => {
          const items: Zotero.Item[] = ctx.items || [];
          const paper = items.length === 1 ? paperItem(items[0]) : null;
          ctx.setVisible(!!paper);
          if (!paper) return;
          ctx.setEnabled(paper.library.editable && !isGenerating(paper));
          // MenuManager writes this straight into data-l10n-args: a JSON string
          ctx.setL10nArgs(
            JSON.stringify({ exists: findContextNote(paper) ? "yes" : "no" }),
          );
        },
        onCommand: (_event: Event, ctx: any) => {
          const items: Zotero.Item[] = ctx.items || [];
          const paper = items.length === 1 ? paperItem(items[0]) : null;
          if (paper)
            void runFor(
              paper,
              ctx.menuElem?.ownerGlobal ?? Zotero.getMainWindow(),
            );
        },
      },
    ],
  });
}
