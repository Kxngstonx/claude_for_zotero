// M3 integration tests: memo collection, paragraph context, Q&A note writes,
// and (ZCA_E2E=1) a real batch with a forced interruption and one retry.
import { assert } from "chai";
import { config } from "../../package.json";
import { api, importSentencesPdf, waitFor } from "./fixtures";

let seq = 0;

async function paper(title: string) {
  const item = new Zotero.Item("journalArticle");
  item.setField("title", title);
  await item.saveTx();
  const att = await importSentencesPdf(item.id);
  return { item, att };
}

/** Bounding rect of `needle` on page 0, computed from the reader's chars. */
async function rectOf(
  att: Zotero.Item,
  needle: string,
  opened: Set<string>,
): Promise<number[]> {
  const reader = await api().annotationContext.readerFor(att, opened);
  const view = reader._internalReader._primaryView;
  await view._ensureBasicPageData(0);
  const chars = view._pdfPages[0].chars;
  const compact = needle.replace(/\s+/g, "");
  const i = chars
    .map((c: any) => c.c)
    .join("")
    .indexOf(compact);
  assert.isAtLeast(i, 0, `"${needle}" in fixture`);
  const cs = chars.slice(i, i + compact.length);
  return [
    Math.min(...cs.map((c: any) => c.rect[0])),
    Math.min(...cs.map((c: any) => c.rect[1])),
    Math.max(...cs.map((c: any) => c.rect[2])),
    Math.max(...cs.map((c: any) => c.rect[3])),
  ];
}

async function annotate(
  att: Zotero.Item,
  o: {
    type?: string;
    text: string;
    comment: string;
    rect?: number[];
    sort?: number;
  },
) {
  const key = Zotero.DataObjectUtilities.generateKey();
  await Zotero.Annotations.saveFromJSON(att, {
    key,
    type: o.type ?? "highlight",
    color: "#ffd400",
    pageLabel: "1",
    sortIndex: `00000|${String(o.sort ?? ++seq).padStart(6, "0")}|00000`,
    position: { pageIndex: 0, rects: [o.rect ?? [0, 0, 1, 1]] },
    text: o.text,
    comment: o.comment,
  });
  return Zotero.Items.getByLibraryAndKey(att.libraryID, key) as Zotero.Item;
}

const silentUI = { stage: () => {}, progress: () => {} };

describe("M3", function () {
  this.timeout(120000);

  it("collects pending questions in paper order (highlight, underline, image)", async function () {
    const { item, att } = await paper("Collect");
    await annotate(att, { text: "B", comment: "@claude second", sort: 20 });
    await annotate(att, {
      text: "A",
      comment: "note\n@claude first\n@claude ✓ done\n@claude also first",
      sort: 10,
    });
    await annotate(att, {
      type: "underline",
      text: "C",
      comment: "@claude third",
      sort: 30,
    });
    await annotate(att, {
      type: "image",
      text: "",
      comment: "@claude figure?",
      sort: 40,
    });
    await annotate(att, {
      type: "note",
      text: "",
      comment: "@claude sticky",
      sort: 50,
    });
    const { pending } = api().memoBatch.collectPending(item);
    // image questions are included since M4; sticky notes are not
    assert.deepEqual(
      pending.map((p: any) => `${p.question}@${p.line}`),
      ["first@2", "also first@4", "second@1", "third@1", "figure?@1"],
    );
  });

  it("finds the paragraph around a highlight from reader chars", async function () {
    const { att } = await paper("Surrounding");
    const opened = new Set<string>();
    try {
      const target = "The server aggregates the updates with FedAvg";
      const ann = await annotate(att, {
        text: target,
        comment: "@claude q",
        rect: await rectOf(att, target, opened),
      });
      const ctx = await api().annotationContext.annotationSurrounding(
        ann,
        att,
        1,
        opened,
      );
      assert.isFalse(ctx.approx);
      assert.include(ctx.text, target);
      // wrong rects: located by text matching instead, still not approximate
      const ann2 = await annotate(att, {
        text: "Scores guide client selection.",
        comment: "@claude q",
        rect: [0, 0, 1, 1],
      });
      const ctx2 = await api().annotationContext.annotationSurrounding(
        ann2,
        att,
        0,
        opened,
      );
      assert.isFalse(ctx2.approx);
      assert.include(ctx2.text, "Scores guide client selection.");
    } finally {
      api().annotationContext.closeTabs(opened);
    }
  });

  it("renders the highlight like 'Add Note from Annotations', without the memo", async function () {
    const { att } = await paper("Quote");
    const ann = await annotate(att, {
      text: "Each client keeps its data local.",
      comment: "@claude secret memo line",
    });
    const html: string = await api().qaNote.annotationQuoteHtml(ann);
    assert.include(html, 'class="highlight"');
    assert.include(html, "data-annotation=");
    assert.include(
      decodeURIComponent(html.match(/data-annotation="([^"]+)"/)![1]),
      `"annotationKey":"${ann.key}"`,
    );
    assert.include(html, 'class="citation"');
    assert.include(html, "Each client keeps its data local.");
    assert.notInclude(html, "secret memo");
  });

  it("appends Q&A entries without rewriting earlier content", async function () {
    const { item } = await paper("Short Title Paper");
    const { qaNote, noteText } = api();
    const entry = (q: string, a: string) =>
      `<hr/><p><strong>Q.</strong> ${q}</p><p>${a}</p><p><em>p.1 · 2026-11-17 16:30 · m · ann:K#1</em></p>`;
    const n1 = await qaNote.appendQaEntry(item, entry("first?", "one"));
    assert.isTrue(n1.hasTag("claude-qa"));
    assert.equal(n1.getNoteTitle(), "Claude Q&A — Short Title Paper");
    // simulate a user edit between writes
    n1.setNote(n1.getNote().replace("</h1>", "</h1><p>my own remark</p>"));
    await n1.saveTx();
    const n2 = await qaNote.appendQaEntry(item, entry("second?", "two"));
    assert.equal(n2.id, n1.id);
    const html = n2.getNote();
    assert.include(html, "my own remark");
    assert.isBelow(html.indexOf("first?"), html.indexOf("second?"));
    const text = noteText.noteHtmlToText(html);
    assert.include(text, "\n---\n");
    assert.equal(
      qaNote.previousQa(item),
      "Q: first?\nA: one\n\nQ: second?\nA: two",
    );
  });

  it("keeps text typed in an open Q&A note editor while a batch appends", async function () {
    const { item } = await paper("Concurrent edit");
    const { qaNote, noteLock } = api();
    const entry = (q: string) =>
      `<hr/><p><strong>Q.</strong> ${q}</p><p>answer</p><p><em>p.1 · 2026-11-17 16:30 · m · ann:K#1</em></p>`;
    const note = await qaNote.appendQaEntry(item, entry("first?"));

    const zp = Zotero.getMainWindow().ZoteroPane;
    await zp.openNoteWindow(note.id);
    const editor = () =>
      (Zotero.Notes as any)._editorInstances.find(
        (x: any) => x._item?.id === note.id && x._iframeWindow,
      );
    const inst = await waitFor(editor, 15000);
    await inst._initPromise;
    await Zotero.Promise.delay(500);
    const el = await waitFor(() =>
      Array.from(
        (zp.findNoteWindow(note.id)?.document.querySelectorAll("note-editor") ??
          []) as any[],
      ).find((e: any) => e.getCurrentInstance?.() === inst),
    );
    try {
      // typed but not yet saved by the editor (its own save is debounced)
      inst._postMessage({
        action: "insertHTML",
        pos: null,
        html: "<p>USER-TYPED-TEXT</p>",
      });
      await Zotero.Promise.delay(50);

      await noteLock.lockNoteEditors(note.id);
      assert.equal(el.mode, "view", "editor is read-only during the batch");
      await qaNote.appendQaEntry(item, entry("second?"));
      await noteLock.refreshLockedEditors(note.id);
      await noteLock.unlockNoteEditors(note.id);
      assert.equal(el.mode, "edit", "editor is editable again");
      await Zotero.Promise.delay(1500); // any editor save would land by now

      const html: string = Zotero.Items.get(note.id).getNote();
      assert.include(html, "USER-TYPED-TEXT", "typed text kept");
      assert.include(html, "second?", "appended entry kept");
      assert.include(html, "first?");
    } finally {
      zp.findNoteWindow(note.id)?.close();
    }
  });

  it("shows a reader toolbar button whose label follows the memo state", async function () {
    const { item, att } = await paper("Toolbar");
    const ann = await annotate(att, { text: "x", comment: "@claude q" });
    const opened = new Set<string>();
    try {
      const reader = await api().annotationContext.readerFor(att, opened);
      const doc = reader._iframeWindow.document;
      const button = await waitFor(
        () =>
          doc.querySelector(".claudeassist-memo-button") as HTMLButtonElement,
        10000,
      );
      assert.equal(button.textContent, "Claude 메모 1");
      assert.isFalse(button.disabled);

      ann.annotationComment = "@claude ✓ q";
      await ann.saveTx();
      await waitFor(() => button.textContent === "Claude 메모", 5000);
      assert.isTrue(button.disabled, "nothing pending and no Q&A note");

      await api().qaNote.appendQaEntry(
        item,
        "<hr/><p><strong>Q.</strong> q</p><p>a</p><p><em>p.1 · 2026-11-17 16:30 · m · ann:K#1</em></p>",
      );
      ann.annotationComment = "@claude ✓ q\nmore"; // any annotation change refreshes
      await ann.saveTx();
      await waitFor(() => button.textContent === "질문 노트", 5000);
      assert.isFalse(button.disabled);
    } finally {
      api().annotationContext.closeTabs(opened);
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

    it("answers, survives an interruption with one retry, marks ✓, re-asks", async function () {
      const { item, att } = await paper("FedVal: Data Valuation for FL");
      const a1 = await annotate(att, {
        text: "The server aggregates the updates with FedAvg",
        comment:
          "my note\n@claude FedAvg는 무엇을 평균하나?\n@claude 서버는 무엇을 받나?",
        sort: 1,
      });
      const a2 = await annotate(att, {
        text: "Scores guide client selection.",
        comment: "@claude 점수는 클라이언트 선택에 어떻게 쓰이나?",
        sort: 2,
      });
      const stages: string[] = [];
      const progress: string[] = [];
      const { memoBatch, contextNote } = api();
      assert.isNull(contextNote.findContextNote(item), "no context note yet");

      const r = await memoBatch.runMemoBatch(
        item,
        {
          stage: (s: string) => stages.push(s),
          progress: (d: number, t: number) => progress.push(`${d}/${t}`),
        },
        { killAfterAnswers: 1 },
      );
      Zotero.debug(
        `[zca test] stages ${JSON.stringify(stages)} result ${JSON.stringify(r)}`,
      );
      assert.isNotNull(
        contextNote.findContextNote(item),
        "context note created lazily",
      );
      assert.equal(r.total, 3);
      assert.deepEqual(r.failures, []);
      assert.equal(r.answered, 3);
      assert.isTrue(
        stages.some((s) => s.includes("다시 요청")),
        "missing answers were requested again after the kill",
      );
      assert.include(progress, "3/3");

      assert.equal(
        Zotero.Items.get(a1.id).annotationComment,
        "my note\n@claude ✓ FedAvg는 무엇을 평균하나?\n@claude ✓ 서버는 무엇을 받나?",
      );
      assert.equal(
        Zotero.Items.get(a2.id).annotationComment,
        "@claude ✓ 점수는 클라이언트 선택에 어떻게 쓰이나?",
      );

      const note = Zotero.Items.get(r.qaNoteID);
      const html: string = note.getNote();
      Zotero.debug(`[zca test] qa note:\n${html.slice(0, 4000)}`);
      assert.isTrue(note.hasTag("claude-qa"));
      assert.equal((html.match(/<hr\/?>/g) || []).length, 3);
      assert.equal((html.match(/class="highlight"/g) || []).length, 3);
      assert.include(html, `ann:${a1.key}#2`);
      assert.include(html, `ann:${a1.key}#3`);
      assert.include(html, `ann:${a2.key}#1`);
      // paper order: a1 questions before a2 (single retry may reorder within a call)
      assert.notInclude(html, "(재질문)");

      // nothing pending now
      const again = await memoBatch.runMemoBatch(item, silentUI);
      assert.equal(again.total, 0);

      // re-ask: remove ✓ on one line
      const a2now = Zotero.Items.get(a2.id);
      a2now.annotationComment =
        "@claude 점수는 클라이언트 선택에 어떻게 쓰이나?";
      await a2now.saveTx();
      const r3 = await memoBatch.runMemoBatch(item, silentUI);
      assert.equal(r3.answered, 1);
      const html2: string = Zotero.Items.get(r3.qaNoteID).getNote();
      assert.match(html2, new RegExp(`ann:${a2.key}#1 \\(재질문\\)`));
      assert.equal((html2.match(/<hr\/?>/g) || []).length, 4);
    });
  });
});
