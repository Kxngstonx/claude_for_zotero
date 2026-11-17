// M1 integration test: sentence context from a real reader on a real PDF.
// Exercises the private reader internals that readerText.ts depends on.
import { assert } from "chai";

import { api, importSentencesPdf, waitFor } from "./fixtures";

describe("M1", function () {
  this.timeout(60000);
  let reader: any;

  before(async function () {
    const att = await importSentencesPdf();
    reader = await Zotero.Reader.open(att.id);
    reader =
      reader ||
      (await waitFor(() =>
        Zotero.Reader._readers.find((r: any) => r.itemID === att.id),
      ));
    await waitFor(
      () =>
        reader._internalReader?._primaryView?._iframeWindow
          ?.PDFViewerApplication?.pdfDocument,
    );
  });

  after(function () {
    if (reader?.tabID) Zotero.getMainWindow().Zotero_Tabs.close(reader.tabID);
  });

  it("finds sentence context by text on the hinted page", async function () {
    const ctx = await api().readerText.selectionSentenceContext(
      reader,
      "The server aggregates the updates with FedAvg",
      0,
      1,
    );
    assert.isNotNull(ctx);
    Zotero.debug("[zca test] text-match ctx " + JSON.stringify(ctx));
    assert.include(ctx.before, "Each client keeps its data local.");
    assert.include(ctx.after, ", as in Fig. 2 of the paper.");
    assert.include(ctx.after, "We study data valuation for this setting.");
    assert.notInclude(ctx.after, "Our method");
  });

  it("uses the reader's selection offsets when there is a selection", async function () {
    const view = reader._internalReader._primaryView;
    await view._ensureBasicPageData(0);
    const chars = view._pdfPages[0].chars;
    assert.isAbove(chars.length, 100);
    const joined = chars.map((c: any) => c.c).join("");
    // chars carry no space characters (spacing is in spaceAfter flags)
    const start = joined.indexOf("Scoresguide");
    assert.isAbove(start, 0, "fixture text found in chars");
    const saved = view._selectionRanges;
    view._selectionRanges = [
      {
        anchorOffset: start,
        headOffset: start + "Scoresguide".length,
        collapsed: false,
        position: { pageIndex: 0 },
      },
    ];
    try {
      const ctx = await api().readerText.selectionSentenceContext(
        reader,
        "ignored",
        undefined,
        1,
      );
      Zotero.debug("[zca test] offset ctx " + JSON.stringify(ctx));
      assert.isNotNull(ctx);
      assert.include(ctx.before, "Our method assigns a score to every client.");
      assert.include(ctx.after, "client selection.");
    } finally {
      view._selectionRanges = saved;
    }
  });

  it("returns null when nothing can be located", async function () {
    const ctx = await api().readerText.selectionSentenceContext(
      reader,
      "text that is not in the pdf",
      0,
      1,
    );
    assert.isNull(ctx);
  });
});
