// Preference pane: connection tests (context.md §12, M0).

import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import {
  errorMessage,
  findClaude,
  listModels,
  resetClaudeBinaryCache,
  runOnce,
} from "../llm/claudeCli";
import { geminiTest } from "../llm/gemini";
import { geminiErrorMessage } from "../llm/geminiApi";
import { ensureUserPrompts, userPromptDir } from "../prompts";
import { logDir } from "../log";

export function registerPrefsPane() {
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: getString("prefs-title"),
    image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
  });
}

export function onPrefsPaneLoad(win: Window) {
  const ref = addon.data.config.addonRef;
  const $ = (id: string) =>
    win.document.getElementById(`${ref}-${id}`) as HTMLElement | null;

  const show = (id: string, text: string) => {
    const el = $(id);
    if (el) el.textContent = text;
  };

  $("gemini-test")?.addEventListener("command", async () => {
    show("gemini-result", "확인 중…");
    try {
      show("gemini-result", `성공: ${await geminiTest()}`);
    } catch (e) {
      show("gemini-result", `실패: ${geminiErrorMessage(e)}`);
    }
  });

  $("claude-path")?.addEventListener("change", () => resetClaudeBinaryCache());

  $("claude-test")?.addEventListener("command", async () => {
    const button = $("claude-test") as XUL.Button | null;
    if (button) button.disabled = true;
    const lines: string[] = [];
    const log = (s: string) => {
      lines.push(s);
      show("claude-result", lines.join("\n"));
    };
    try {
      resetClaudeBinaryCache();
      log("claude 바이너리 찾는 중…");
      const bin = await findClaude();
      if (!bin) {
        log("실패: claude CLI를 찾지 못했습니다. 경로를 직접 입력하세요.");
        return;
      }
      log(`경로: ${bin.path}\n버전: ${bin.version}`);
      const model = getPref("claude.modelAnswer");
      log(
        `짧은 호출 실행 중 (모델 ${model})… 처음이면 macOS 키체인 허용 창이 뜰 수 있습니다.`,
      );
      const res = await runOnce({
        feature: "connection-test",
        systemPrompt:
          "You are a connection test. Reply with exactly the single word: PONG",
        content: [{ type: "text", text: "ping" }],
        model,
        timeoutSec: 90,
      });
      log(`응답: ${res.text.trim()}  (로그인·JSON 파싱 정상)`);
      const models = await listModels();
      log(
        `사용 가능한 모델:\n${models.map((m) => `  ${m.value} — ${m.displayName ?? ""}`).join("\n")}`,
      );
    } catch (e) {
      log(`실패: ${errorMessage(e)}`);
    } finally {
      if (button) button.disabled = false;
    }
  });

  // A newly chosen folder gets the default files right away (not only at startup).
  const syncPromptDir = async () => {
    show("prompts-current", `현재 위치: ${userPromptDir()}`);
    try {
      await ensureUserPrompts();
    } catch (e) {
      show("prompts-current", `프롬프트 복사 실패: ${e}`);
    }
  };
  show("prompts-current", `현재 위치: ${userPromptDir()}`);
  $("prompts-dir")?.addEventListener("change", syncPromptDir);
  $("log-open")?.addEventListener("command", async () => {
    await IOUtils.makeDirectory(logDir(), { createAncestors: true });
    Zotero.File.reveal(logDir());
  });
  $("prompts-open")?.addEventListener("command", async () => {
    await syncPromptDir();
    Zotero.File.reveal(userPromptDir());
  });
}
