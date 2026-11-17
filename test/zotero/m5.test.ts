// M5 integration tests: section files from the structured text, and (with
// ZCA_E2E=1) a real chat: section reads, multi-turn, resume after the process
// stops, out-of-directory reads denied, stop and reset.
import { assert } from "chai";
import { config } from "../../package.json";
import { api, importOutlinePdf, waitFor } from "./fixtures";

async function paper(title: string) {
  const item = new Zotero.Item("journalArticle");
  item.setField("title", title);
  await item.saveTx();
  const att = await importOutlinePdf(item.id);
  return { item, att };
}

describe("M5", function () {
  this.timeout(180000);

  it("builds sections from the PDF outline and writes section files", async function () {
    const { att } = await paper("Sections");
    const sections = await api().sections.paperSections(att);
    assert.deepEqual(
      sections.map((s: any) => s.file),
      [
        "s01_1_Introduction_p1.md",
        "s02_2_Method_p2-3.md",
        "s03_2_1_Model_p3.md",
        "s04_3_Experiments_p4.md",
      ],
    );
    assert.include(sections[1].text, "BANANA");
    assert.include(sections[1].text, "overview of the method continues");
    assert.notInclude(sections[1].text, "CHERRY");
    const dir = PathUtils.join(PathUtils.tempDir, "zca-sections-test");
    await api().sections.writeSectionFiles(dir, sections);
    const text = await IOUtils.readUTF8(
      PathUtils.join(dir, "s03_2_1_Model_p3.md"),
    );
    assert.match(text, /^# 2\.1 Model \(p\.3\)\n\n/);
    assert.include(text, "CHERRY");
  });

  it("renders the chat UI and keeps model Markdown inert", async function () {
    const { item } = await paper("Chat UI");
    const doc = Zotero.getMainWindow().document;
    const container = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    doc.documentElement.append(container);
    try {
      api().chatPanel.mountChat(container, item.id);
      await Zotero.Promise.delay(200);
      assert.exists(container.querySelector("textarea"));
      assert.include(container.textContent, "논문 전체에 대한 질문");
      const nodes = api().chatPanel.markdownNodes(
        doc,
        "**굵게** <script>alert(1)</script> $x_i$ [link](javascript:alert(1))",
      );
      const holder = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      holder.append(...nodes);
      assert.isNull(holder.querySelector("script"));
      assert.isNull(holder.querySelector("a"));
      assert.include(holder.textContent, "<script>alert(1)</script>");
      assert.equal(holder.querySelector("strong")?.textContent, "굵게");

      // Location tags become marks; page marks are clickable, code is left alone.
      const cited = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      cited.append(
        ...api().chatPanel.markdownNodes(
          doc,
          "A [Sec 3, p.4] B [Interpretation] `[p.9]`",
          () => {},
        ),
      );
      const marks = [...cited.querySelectorAll(".zca-cite")] as HTMLElement[];
      assert.deepEqual(
        marks.map((m) => [m.textContent, m.dataset.page ?? null]),
        [
          ["p.4", "4"],
          ["해석", null],
        ],
      );
      assert.include(cited.querySelector("code")?.textContent, "[p.9]");
    } finally {
      container.remove();
    }
  });

  it("opens one chat window per paper with memo and Q&A note buttons", async function () {
    const { item, att } = await paper("Window");
    const key = Zotero.DataObjectUtilities.generateKey();
    await Zotero.Annotations.saveFromJSON(att, {
      key,
      type: "highlight",
      color: "#ffd400",
      pageLabel: "1",
      sortIndex: "00000|000001|00000",
      position: { pageIndex: 0, rects: [[0, 0, 1, 1]] },
      text: "magic word",
      comment: "@claude 이 단어는?",
    });
    const { chatWindow, qaNote } = api();
    const win: Window = chatWindow.openChatWindow(item);
    try {
      const memo = await waitFor(
        () => win.document?.getElementById("zca-memo") as HTMLButtonElement,
        10000,
      );
      assert.equal(memo.textContent, "답변 생성");
      assert.isFalse(memo.disabled);
      assert.include(
        win.document.querySelector(".zca-pending")?.textContent,
        "메모 질문 1개 대기 · p.1",
      );
      const qa = win.document.getElementById("zca-qa") as HTMLButtonElement;
      assert.isTrue(qa.disabled, "no Q&A note yet");
      const ctx = win.document.getElementById(
        "zca-context",
      ) as HTMLButtonElement;
      assert.isTrue(ctx.disabled, "no context note yet");
      assert.match(
        win.document.querySelector(".zca-wtitle")?.textContent ?? "",
        /^Window/,
      );
      await waitFor(
        () =>
          win.document.getElementById("zca-model")?.textContent === "Sonnet",
        5000,
      );
      assert.exists(win.document.querySelector(".zca-chat textarea"));
      assert.match(win.document.title, /^Claude — Window/);
      assert.strictEqual(chatWindow.openChatWindow(item), win, "reused");

      await qaNote.appendQaEntry(
        item,
        "<hr/><p><strong>Q.</strong> q</p><p>a</p><p><em>p.1 · 2026-11-17 16:30 · m · ann:K#1</em></p>",
      );
      await waitFor(() => !qa.disabled, 5000);
    } finally {
      win.close();
    }
  });

  describe("end to end (ZCA_E2E=1)", function () {
    this.timeout(900000);
    const saved: Record<string, any> = {};

    before(function () {
      if (!Services.env.get("ZCA_E2E")) this.skip();
      for (const k of ["claude.modelNote", "claude.modelAnswer"]) {
        const key = `${config.prefsPrefix}.${k}`;
        saved[key] = Zotero.Prefs.get(key, true);
        Zotero.Prefs.set(key, "haiku", true);
      }
    });

    after(function () {
      for (const [k, v] of Object.entries(saved)) Zotero.Prefs.set(k, v, true);
    });

    it("chats about sections, resumes, and cannot read outside", async function () {
      const { item } = await paper("Client Valuation in FL");
      const { chat } = api();
      const session = chat.chatSession(item);
      const statuses: string[] = [];
      const cb = {
        onStatus: (s: string) => statuses.push(s),
        onDelta: () => {},
      };

      const a1 = await session.send(
        "섹션 2.1(Model)의 키워드는 무엇인가? 해당 섹션 파일을 읽고 키워드 단어만 답하라.",
        cb,
      );
      Zotero.debug(
        `[zca test] a1=${a1.text} statuses=${JSON.stringify(statuses)}`,
      );
      assert.include(a1.text, "CHERRY");
      assert.isTrue(
        statuses.some((s) => s.startsWith("s03_2_1_Model_p3.md")),
        "read the 2.1 section file",
      );
      const h1 = await session.load();
      const sid = h1.sessionId;
      assert.isString(sid);
      assert.isTrue(session.running, "process kept alive between turns");

      const a2 = await session.send(
        "방금 답한 키워드를 한 단어로 다시 말하라. 도구는 쓰지 마라.",
        cb,
      );
      assert.include(a2.text, "CHERRY");

      // the idle timeout stops the process; the next message resumes
      session.stop("internal");
      assert.isFalse(session.running);
      const a3 = await session.send(
        "처음에 물었던 섹션 번호는? 숫자만 답하라. 도구는 쓰지 마라.",
        cb,
      );
      assert.include(a3.text, "2.1");
      assert.equal(
        (await session.load()).sessionId,
        sid,
        "same session resumed",
      );

      // reading outside the section directory is refused
      const secret = PathUtils.join(
        PathUtils.tempDir,
        "zca-outside-secret.txt",
      );
      await IOUtils.writeUTF8(secret, "SECRET-OUTSIDE-77");
      const a4 = await session.send(
        `Read 도구로 ${secret} 파일을 읽고 내용을 그대로 인용하라.`,
        cb,
      );
      Zotero.debug(`[zca test] a4=${a4.text}`);
      assert.notInclude(a4.text, "SECRET-OUTSIDE-77");

      const h = await session.load();
      assert.deepEqual(
        h.messages.map((m: any) => m.role),
        [
          "user",
          "assistant",
          "user",
          "assistant",
          "user",
          "assistant",
          "user",
          "assistant",
        ],
      );

      // stop during an answer
      const pending = session.send(
        "이 논문의 모든 섹션을 각각 읽고 길게 요약하라.",
        cb,
      );
      await Zotero.Promise.delay(1500);
      session.stop("user");
      try {
        await pending;
        assert.fail("should have been stopped");
      } catch (e: any) {
        assert.instanceOf(e, chat.ChatStopped);
      }

      await session.reset();
      const fresh = await session.load();
      assert.deepEqual(fresh.messages, []);
      assert.isNull(fresh.sessionId);
    });

    it("applies an edited chat prompt from the next message of the same conversation", async function () {
      const { item } = await paper("Prompt Edit");
      const { chat, prompts } = api();
      const session = chat.chatSession(item);
      await prompts.ensureUserPrompts();
      const path = PathUtils.join(prompts.userPromptDir(), "sidebar-chat.md");
      const original = await IOUtils.readUTF8(path);
      try {
        const a1 = await session.send("한 단어로 인사하라. 도구는 쓰지 마라.");
        assert.notInclude(a1.text, "ZEBRA-MARK");
        const sid = (await session.load()).sessionId;
        await IOUtils.writeUTF8(
          path,
          original +
            "\n\n## Test rule\n* End every answer with the exact token ZEBRA-MARK on its own line.\n",
        );
        const a2 = await session.send(
          "한 단어로 다시 인사하라. 도구는 쓰지 마라.",
        );
        Zotero.debug(`[zca test] prompt edit a2=${a2.text}`);
        assert.include(a2.text, "ZEBRA-MARK");
        assert.equal(
          (await session.load()).sessionId,
          sid,
          "same conversation",
        );
      } finally {
        await IOUtils.writeUTF8(path, original);
        await session.reset();
      }
    });

    it("answers memo questions from the window button and records a chat notice", async function () {
      const { item, att } = await paper("Window Memos");
      const key = Zotero.DataObjectUtilities.generateKey();
      await Zotero.Annotations.saveFromJSON(att, {
        key,
        type: "highlight",
        color: "#ffd400",
        pageLabel: "2",
        sortIndex: "00001|000001|00000",
        position: { pageIndex: 1, rects: [[0, 0, 1, 1]] },
        text: "The method section keyword is BANANA.",
        comment: "@claude 이 문장의 키워드는? 한 단어로.",
      });
      const win: Window = api().chatWindow.openChatWindow(item);
      try {
        const memo = await waitFor(
          () => win.document?.getElementById("zca-memo") as HTMLButtonElement,
          10000,
        );
        memo.click();
        await waitFor(
          () =>
            /메모 질문: 처리 1건, 실패 0건/.test(
              win.document.querySelector(".zca-chat")?.textContent ?? "",
            ),
          600000,
        );
        assert.isTrue(memo.disabled);
        assert.include(
          win.document.querySelector(".zca-pending")?.textContent,
          "대기 중인 메모 질문 없음",
        );
        assert.include(
          win.document.getElementById("zca-memo-status")?.textContent,
          "메모 질문 1개에 답했습니다",
        );
        assert.isFalse(
          (win.document.getElementById("zca-qa") as HTMLButtonElement).disabled,
        );
        const h = await api().chat.chatSession(item).load();
        assert.equal(h.messages.at(-1).role, "notice");
      } finally {
        win.close();
      }
    });

    it("sends from the UI and saves an answer as a 전역 질문 entry", async function () {
      const { item } = await paper("UI Chat Save");
      const doc = Zotero.getMainWindow().document;
      const container = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      ) as HTMLElement;
      doc.documentElement.append(container);
      try {
        api().chatPanel.mountChat(container, item.id);
        const input = container.querySelector(
          "textarea",
        ) as HTMLTextAreaElement;
        const sendBtn = container.querySelector(
          ".zca-send",
        ) as HTMLButtonElement;
        input.value =
          "섹션 3 Experiments 파일을 읽고, 그 안에서 'Keyword' 바로 다음에 나오는 대문자 단어만 답하라.";
        sendBtn.click();
        const save = await waitFor(
          () =>
            [...container.querySelectorAll("button")].find(
              (b) => b.textContent === "질문 노트에 저장",
            ) as HTMLButtonElement,
          300000,
        );
        assert.include(container.textContent, "DURIAN");
        save.click();
        await waitFor(
          () =>
            container.querySelector(".zca-saved")?.textContent ===
            "✓ 질문 노트에 저장됨",
          20000,
        );
        const note = api().qaNote.findQaNote(item);
        const html: string = note.getNote();
        assert.include(html, "<strong>전역 질문</strong>");
        assert.include(html, "섹션 3 Experiments 파일을 읽고");
        assert.include(html, "DURIAN");
        assert.match(
          html,
          /<em>전역 질문 · \d{4}-\d{2}-\d{2} \d{2}:\d{2} · claude-haiku/,
        );

        // "/memos" is a command, not a chat message
        input.value = "/memos";
        sendBtn.click();
        await Zotero.Promise.delay(300);
        const h = await api().chat.chatSession(item).load();
        assert.notInclude(
          h.messages.map((m: any) => m.text),
          "/memos",
        );
      } finally {
        container.remove();
      }
    });
  });
});
