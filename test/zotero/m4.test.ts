// M4 integration tests: figure (image annotation) questions.
import { assert } from "chai";
import { config } from "../../package.json";
import { api, FIGURE_RECT, importFigurePdf } from "./fixtures";

async function paper(title: string) {
  const item = new Zotero.Item("journalArticle");
  item.setField("title", title);
  await item.saveTx();
  const att = await importFigurePdf(item.id);
  return { item, att };
}

async function imageAnnotation(att: Zotero.Item, comment: string) {
  const key = Zotero.DataObjectUtilities.generateKey();
  await Zotero.Annotations.saveFromJSON(att, {
    key,
    type: "image",
    color: "#ffd400",
    pageLabel: "1",
    sortIndex: "00000|000100|00000",
    position: { pageIndex: 0, rects: [FIGURE_RECT] },
    comment,
  });
  return Zotero.Items.getByLibraryAndKey(att.libraryID, key) as Zotero.Item;
}

const isPng = (b: Uint8Array) =>
  b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

describe("M4", function () {
  this.timeout(120000);

  it("renders the figure region of an image annotation", async function () {
    const { att } = await paper("Render");
    const ann = await imageAnnotation(att, "@claude q");
    const png: Uint8Array = await api().annotationImage.annotationPng(ann);
    assert.isNotNull(png);
    assert.isTrue(isPng(png), "PNG signature");
    assert.isAbove(png.length, 1000);
    const img = await api().annotationImage.imageForModel(png);
    assert.equal(img.mediaType, "image/png");
    assert.match(img.data, /^iVBORw0KGgo/); // base64 of the PNG signature
  });

  it("finds the caption and nearby paragraphs around a figure", async function () {
    const { att } = await paper("Caption");
    const ann = await imageAnnotation(att, "@claude q");
    const opened = new Set<string>();
    try {
      const ctx = await api().annotationContext.figureSurrounding(
        ann,
        att,
        1,
        opened,
      );
      Zotero.debug(`[zca test] figure ctx ${JSON.stringify(ctx)}`);
      assert.isFalse(ctx.approx);
      assert.include(
        ctx.text,
        "Figure 1: Final accuracy of Alpha, Beta and Gamma",
      );
      assert.notInclude(
        ctx.text,
        "Alpha Beta Gamma",
        "bar labels inside the figure are not context",
      );
    } finally {
      api().annotationContext.closeTabs(opened);
    }
  });

  it("embeds the figure in the Q&A note as an image attachment of the note", async function () {
    const { item, att } = await paper("Embed");
    const ann = await imageAnnotation(att, "@claude q");
    const { qaNote, annotationImage } = api();
    const png = await annotationImage.annotationPng(ann);
    const note = await qaNote.ensureQaNote(item);
    const html: string = await qaNote.annotationQuoteHtml(
      ann,
      await qaNote.importFigure(png, note),
    );
    const key = html.match(/<img data-attachment-key="([A-Z0-9]+)"/)?.[1];
    assert.exists(key, html.slice(0, 300));
    const img = Zotero.Items.getByLibraryAndKey(
      item.libraryID,
      key!,
    ) as Zotero.Item;
    assert.equal(img.parentID, note.id);
    assert.include(html, "data-annotation=");
    assert.include(html, 'class="citation"');
    assert.equal((await qaNote.ensureQaNote(item)).id, note.id, "one Q&A note");
    // an unreferenced import is removed, a referenced one is kept
    const orphan = await qaNote.importFigure(png, note);
    await qaNote.removeUnusedFigure(note, orphan);
    assert.isFalse(!!Zotero.Items.getByLibraryAndKey(item.libraryID, orphan));
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

    it("answers a figure question from the image and embeds the figure", async function () {
      const { item, att } = await paper("Aggregation Rules Compared");
      const ann = await imageAnnotation(
        att,
        "@claude 그림에서 막대가 가장 높은 방법은 무엇이고, 가장 낮은 방법은 무엇인가?",
      );
      const r = await api().memoBatch.runMemoBatch(item, {
        stage: () => {},
        progress: () => {},
      });
      Zotero.debug(`[zca test] m4 result ${JSON.stringify(r)}`);
      assert.deepEqual(r.failures, []);
      assert.equal(r.answered, 1);
      assert.match(Zotero.Items.get(ann.id).annotationComment, /^@claude ✓ /);
      const html: string = Zotero.Items.get(r.qaNoteID).getNote();
      Zotero.debug(`[zca test] m4 note ${html.slice(0, 3000)}`);
      assert.match(html, /<img data-attachment-key="[A-Z0-9]+"/);
      assert.include(html, `ann:${ann.key}#1`);
      const answer = html.slice(html.indexOf("<strong>Q.</strong>"));
      assert.include(answer, "Gamma");
      assert.include(answer, "Alpha");
    });
  });
});
