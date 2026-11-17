// M2 integration tests: page text without the reader, context note lookup,
// and (with ZCA_E2E=1) a real end-to-end generation with a small model.
import { assert } from "chai";
import { config } from "../../package.json";
import { api, importSentencesPdf } from "./fixtures";

async function paperWithPdf(title: string) {
  const item = new Zotero.Item("journalArticle");
  item.setField("title", title);
  item.setCreators([
    { firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
  ]);
  item.setField("date", "2024-05-01");
  await item.saveTx();
  const att = await importSentencesPdf(item.id);
  return { item, att };
}

const key = `${config.prefsPrefix}.claude.modelNote`;

async function taggedNote(parent: Zotero.Item, text: string) {
  const n = new Zotero.Item("note");
  n.libraryID = parent.libraryID;
  n.parentID = parent.id;
  n.setNote(`<div data-schema-version="9"><p>${text}</p></div>`);
  n.addTag("claude-context");
  await n.saveTx();
  return n;
}

describe("M2", function () {
  this.timeout(60000);

  it("extracts page-marked text without opening the reader", async function () {
    const { item, att } = await paperWithPdf("Text extraction");
    const before = Zotero.Reader._readers.length;
    const pdf = await api().fullText.paperPdf(item);
    assert.equal(pdf.id, att.id);
    const r = await api().fullText.pdfFullText(pdf);
    assert.equal(r.pageCount, 1);
    assert.match(r.text, /^=== Page 1 ===\nFederated learning trains a model/);
    assert.include(r.text, "Scores guide client selection.");
    assert.equal(Zotero.Reader._readers.length, before, "no reader opened");
  });

  it("maps an attachment to its parent paper", async function () {
    const { item, att } = await paperWithPdf("Parent lookup");
    assert.equal(api().contextNote.paperItem(att).id, item.id);
    assert.equal(api().contextNote.paperItem(item).id, item.id);
  });

  it("finds the newest of several context notes", async function () {
    const { item } = await paperWithPdf("Two notes");
    assert.isNull(api().contextNote.findContextNote(item));
    await taggedNote(item, "old");
    await Zotero.Promise.delay(1100); // dateModified has 1 s resolution
    const newer = await taggedNote(item, "new");
    assert.equal(api().contextNote.findContextNote(item).id, newer.id);
  });

  describe("end to end (ZCA_E2E=1)", function () {
    this.timeout(600000);
    let saved: any;

    before(function () {
      if (!Services.env.get("ZCA_E2E")) this.skip();
      saved = Zotero.Prefs.get(key, true);
      Zotero.Prefs.set(key, "haiku", true);
    });

    after(function () {
      if (saved !== undefined) Zotero.Prefs.set(key, saved, true);
    });

    it("generates, stores and locks per item", async function () {
      const { item } = await paperWithPdf("FedVal: Data Valuation for FL");
      const { contextNote } = api();
      const stages: string[] = [];
      const p1 = contextNote.regenerateContextNote(item, (s: string) =>
        stages.push(s),
      );
      const p2 = contextNote.ensureContextNote(item);
      assert.strictEqual(p2, p1, "second request waits for the running one");
      assert.isTrue(contextNote.isGenerating(item));
      const note = await p1;
      assert.isFalse(contextNote.isGenerating(item));
      assert.includeMembers(stages, ["text", "model", "save"]);

      const html: string = note.getNote();
      Zotero.debug(`[zca test] context note html:\n${html.slice(0, 3000)}`);
      assert.isTrue(note.hasTag("claude-context"));
      assert.equal(note.parentID, item.id);
      assert.match(
        html,
        /^<div data-schema-version="9"><h1>Claude 컨텍스트 노트 — FedVal: Data Valuation for FL<\/h1><p>생성: claude-haiku[^<]* · 프롬프트 context-note v1 · 본문 1쪽/,
      );
      assert.match(html, /p\.\s?1/, "location tags carry the page");
      assert.notInclude(html, "<script");
      assert.equal(
        note.getNoteTitle(),
        "Claude 컨텍스트 노트 — FedVal: Data Valuation for FL",
      );

      // ensure returns the stored note without a new call
      assert.equal((await contextNote.ensureContextNote(item)).id, note.id);

      // regeneration overwrites the same note
      const again = await contextNote.regenerateContextNote(item);
      assert.equal(again.id, note.id);
      assert.lengthOf(contextNote.taggedNotes(item, "claude-context"), 1);
    });
  });
});
