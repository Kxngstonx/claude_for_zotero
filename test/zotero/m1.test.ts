// M1 integration test: sentence context from a real reader on a real PDF.
// Exercises the private reader internals that readerText.ts depends on.
import { assert } from "chai";
import { config } from "../../package.json";

// @ts-expect-error - Plugin instance is not typed
const api = () => Zotero[config.addonInstance].api;

// test/fixtures/make-sentences-pdf.py output (one page, Helvetica text).
const PDF_B64 =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAzNDAgPj4Kc3RyZWFtCkJUCi9GMSAxMSBUZgoxNCBUTAo3MiA3MjAgVGQKKEZlZGVyYXRlZCBsZWFybmluZyB0cmFpbnMgYSBtb2RlbCBhY3Jvc3MgbWFueSBjbGllbnRzLiBFYWNoIGNsaWVudCBrZWVwcykgVGoKVCogKGl0cyBkYXRhIGxvY2FsLiBUaGUgc2VydmVyIGFnZ3JlZ2F0ZXMgdGhlIHVwZGF0ZXMgd2l0aCBGZWRBdmcsIGFzIGluKSBUagpUKiAoRmlnLiAyIG9mIHRoZSBwYXBlci4gV2Ugc3R1ZHkgZGF0YSB2YWx1YXRpb24gZm9yIHRoaXMgc2V0dGluZy4gT3VyKSBUagpUKiAobWV0aG9kIGFzc2lnbnMgYSBzY29yZSB0byBldmVyeSBjbGllbnQuIFNjb3JlcyBndWlkZSBjbGllbnQgc2VsZWN0aW9uLikgVGoKRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDA2MzIgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo3MDIKJSVFT0YK";

async function waitFor<T>(fn: () => T, ms = 30000): Promise<NonNullable<T>> {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() > until) throw new Error("timed out waiting");
    await Zotero.Promise.delay(200);
  }
}

describe("M1", function () {
  this.timeout(60000);
  let reader: any;

  before(async function () {
    const path = PathUtils.join(PathUtils.tempDir, "zca-sentences.pdf");
    await IOUtils.write(
      path,
      Uint8Array.from(atob(PDF_B64), (c) => c.charCodeAt(0)),
    );
    const att = await Zotero.Attachments.importFromFile({ file: path });
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
