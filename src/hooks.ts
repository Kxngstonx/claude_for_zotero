import { initLocale } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";
import { onPrefsPaneLoad, registerPrefsPane } from "./modules/prefsPane";
import { ensureUserPrompts } from "./prompts";
import { registerTranslate, unregisterTranslate } from "./features/translate";
import { registerContextNoteMenu } from "./features/contextNoteMenu";
import {
  registerMemoPanel,
  unregisterMemoPanel,
} from "./features/sidebar/memoPanel";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  registerPrefsPane();
  registerTranslate();
  registerContextNoteMenu();
  registerMemoPanel();

  try {
    await ensureUserPrompts();
  } catch (e) {
    ztoolkit.log("ensureUserPrompts failed", e);
  }

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();
  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  unregisterTranslate();
  unregisterMemoPanel();
  ztoolkit.unregisterAll();
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      onPrefsPaneLoad(data.window);
      break;
    default:
      return;
  }
}

// Hooks only dispatch; real work lives in modules.
export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
};
