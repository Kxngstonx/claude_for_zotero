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

  const title = String(item.getField("title") || "").slice(0, 50);
  const popup = new ztoolkit.ProgressWindow("Claude 컨텍스트 노트", {
    closeOnClick: false,
    closeTime: -1,
  })
    .createLine({ text: `${title}\n준비 중…`, type: "default", progress: 5 })
    .show();

  let last = 0;
  let lastStage = "";
  const onProgress: GenerateProgress = (stage, detail) => {
    const now = Date.now();
    // throttle repeated streaming updates, never a stage change
    if (stage === lastStage && now - last < 500) return;
    last = now;
    lastStage = stage;
    const progress = stage === "text" ? 10 : stage === "model" ? 40 : 90;
    popup.changeLine({
      text: `${title}\n${STAGE[stage]}${detail ? ` (${detail})` : ""}`,
      progress,
    });
  };

  try {
    await regenerateContextNote(item, onProgress);
    popup.changeLine({
      text: `${title}\n노트를 저장했습니다.`,
      type: "success",
      progress: 100,
    });
    popup.startCloseTimer(5000);
  } catch (e) {
    popup.changeLine({
      text: `${title}\n실패: ${errorMessage(e)}`,
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
