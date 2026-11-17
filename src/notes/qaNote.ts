// Q&A note: lookup, creation on first write, append-only entries
// (context.md §8.3).

import { getPref } from "../utils/prefs";
import { paperMeta, taggedNotes } from "./contextNote";
import { shortTitle } from "./contextNoteFormat";
import { appendEntry, previousQaText, QA_TAG, qaNoteHtml } from "./qaFormat";
import { noteHtmlToText } from "./noteText";
import { dbIdle } from "./noteLock";

export function findQaNote(item: Zotero.Item): Zotero.Item | null {
  return taggedNotes(item, QA_TAG)[0] ?? null;
}

// Writes to one paper's Q&A note are serialized.
const writes = new Map<number, Promise<unknown>>();

function serialized<T>(item: Zotero.Item, fn: () => Promise<T>): Promise<T> {
  const prev = writes.get(item.id) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  writes.set(item.id, next);
  return next;
}

async function createQaNote(item: Zotero.Item): Promise<Zotero.Item> {
  const note = new Zotero.Item("note");
  note.libraryID = item.libraryID;
  note.parentID = item.id;
  note.addTag(QA_TAG);
  const meta = paperMeta(item);
  note.setNote(
    qaNoteHtml(
      shortTitle(meta.title, String(item.getField("shortTitle") || "")),
    ),
  );
  await note.saveTx();
  return note;
}

/** The Q&A note, created (empty, with title and tag) if there is none. */
export function ensureQaNote(item: Zotero.Item): Promise<Zotero.Item> {
  return serialized(item, async () => findQaNote(item) ?? createQaNote(item));
}

/** Appends an entry; creates the note (tag claude-qa) on the first write. */
export function appendQaEntry(
  item: Zotero.Item,
  entryHtml: string,
): Promise<Zotero.Item> {
  return serialized(item, async () => {
    const note = findQaNote(item) ?? (await createQaNote(item));
    // An editor save queued before ours can replace the note's content just
    // before our transaction commits; verify and append again if so.
    for (let attempt = 1; ; attempt++) {
      await dbIdle();
      const html = appendEntry(note.getNote(), entryHtml);
      note.setNote(html);
      await note.saveTx();
      await dbIdle();
      // In memory the note holds exactly what was set unless another save
      // replaced it in between.
      if (note.getNote() === html) return note;
      if (attempt >= 3) {
        throw new Error(
          "질문 노트에 기록한 내용이 다른 저장에 덮어써졌습니다.",
        );
      }
      Zotero.debug(
        `[Claude Assist] Q&A entry overwritten, appending again (${attempt})`,
      );
    }
  });
}

/** <previous_qa> text for prompts (§9.3). */
export function previousQa(item: Zotero.Item): string {
  const note = findQaNote(item);
  if (!note) return "";
  return previousQaText(
    noteHtmlToText(note.getNote()),
    Number(getPref("qa.previousQaChars")) || 0,
  );
}

/**
 * Imports a figure as an image attachment embedded in the note (as Zotero's
 * editor does in importImages). Returns the attachment key.
 */
export async function importFigure(
  png: Uint8Array,
  note: Zotero.Item,
): Promise<string> {
  const win = Zotero.getMainWindow() as any;
  const blob = new win.Blob([png], { type: "image/png" });
  const att = await Zotero.Attachments.importEmbeddedImage({
    blob,
    parentItemID: note.id,
  });
  return att.key;
}

/** Deletes an embedded figure that no note content refers to. */
export async function removeUnusedFigure(
  note: Zotero.Item,
  key: string,
): Promise<void> {
  if (note.getNote().includes(`data-attachment-key="${key}"`)) return;
  const att = Zotero.Items.getByLibraryAndKey(note.libraryID, key);
  if (att) await att.eraseTx();
}

/**
 * The highlight as Zotero's "Add Note from Annotations" renders it: a
 * highlight span (click → PDF location) and a citation; for an image
 * annotation, the embedded figure `imageKey` (see importFigure). The comment
 * is left out (it holds the @claude lines).
 */
export async function annotationQuoteHtml(
  annotation: Zotero.Item,
  imageKey?: string,
): Promise<string> {
  const json: any = await Zotero.Annotations.toJSON(annotation);
  json.attachmentItemID = annotation.parentID;
  json.id = annotation.key;
  json.comment = null;
  delete json.image;
  if (imageKey) json.imageAttachmentKey = imageKey;
  const { html } = Zotero.EditorInstanceUtilities.serializeAnnotations([json]);
  return html;
}
