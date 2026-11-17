// M0 integration tests, run inside a throwaway Zotero profile and data
// directory (.scaffold/test/). They call the real `claude` CLI, so they use a
// small amount of the subscription quota.
import { assert } from "chai";
import { config } from "../../package.json";

// @ts-expect-error - Plugin instance is not typed
const api = () => Zotero[config.addonInstance].api;

describe("M0", function () {
  describe("prompts", function () {
    it("copies bundled defaults into the editable prompt directory", async function () {
      const { prompts } = api();
      await prompts.ensureUserPrompts();
      const dir = prompts.userPromptDir();
      assert.include(dir, "zotero-claude-assist");
      for (const name of prompts.PROMPT_FILES) {
        assert.isTrue(
          await IOUtils.exists(PathUtils.join(dir, ...name.split("/"))),
          name,
        );
      }
    });

    it("prefers the edited copy over the bundled default", async function () {
      const { prompts } = api();
      const path = PathUtils.join(prompts.userPromptDir(), "translate.md");
      const original = await IOUtils.readUTF8(path);
      try {
        await IOUtils.writeUTF8(path, "EDITED");
        assert.equal(await prompts.loadPrompt("translate.md"), "EDITED");
      } finally {
        await IOUtils.writeUTF8(path, original);
      }
      const memo = await prompts.composePrompt(
        "memo-batch.md",
        "humanize-digest.md",
      );
      assert.include(memo, "prompt-version: memo-batch");
    });
  });

  describe("claude CLI", function () {
    this.timeout(180000);

    it("finds the installed binary", async function () {
      const bin = await api().claude.findClaude();
      assert.isNotNull(bin);
      assert.match(bin.version, /\d+\.\d+\.\d+/);
    });

    it("runs a one-shot call and streams text", async function () {
      const chunks: string[] = [];
      const res = await api().claude.runOnce({
        systemPrompt: "Reply with exactly the single word: PONG",
        content: [{ type: "text", text: "ping" }],
        model: "haiku",
        timeoutSec: 120,
        onText: (d: string) => chunks.push(d),
      });
      assert.include(res.text, "PONG");
      assert.isAbove(chunks.length, 0);
    });

    it("classifies an unknown model", async function () {
      const { claude } = api();
      try {
        await claude.runOnce({
          systemPrompt: "x",
          content: [{ type: "text", text: "hi" }],
          model: "no-such-model",
          timeoutSec: 60,
        });
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.equal(e.kind, "model", String(e));
      }
    });

    it("kills the process on timeout", async function () {
      try {
        await api().claude.runOnce({
          systemPrompt: "Write a 2000-word essay.",
          content: [{ type: "text", text: "go" }],
          model: "haiku",
          timeoutSec: 1,
        });
        assert.fail("should have timed out");
      } catch (e: any) {
        assert.equal(e.kind, "timeout", String(e));
      }
    });

    it("lists models via initialize", async function () {
      const models = await api().claude.listModels();
      assert.includeMembers(
        models.map((m: any) => m.value),
        ["opus", "sonnet"],
      );
    });
  });

  describe("prefs", function () {
    it("keeps int prefs as numbers when the pane writes a string", function () {
      const key = `${config.prefsPrefix}.timeout.noteSec`;
      const before = Zotero.Prefs.get(key, true);
      try {
        Zotero.Prefs.set(key, "900", true);
        assert.strictEqual(Zotero.Prefs.get(key, true), 900);
      } finally {
        Zotero.Prefs.set(key, before, true);
      }
    });
  });
});
