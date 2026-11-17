// Q&A note: lookup, creation on first write, append-only entries
// (context.md §8.3).

import { getPref } from "../utils/prefs";
import { paperMeta, taggedNotes } from "./contextNote";
import { shortTitle } from "./contextNoteFormat";
import { appendEntry, previousQaText, QA_TAG, qaNoteHtml } from "./qaFormat";
import { noteHtmlToText } from "./noteText";

export function findQaNote(item: Zotero.Item): Zotero.Item | null {
  return taggedNotes(item, QA_TAG)[0] ?? null;
}

// Writes to one paper's Q&A note are serialized.
const writes = new Map<number, Promise<unknown>>();

/** Appends an entry; creates the note (tag claude-qa) on the first write. */
export function appendQaEntry(
  item: Zotero.Item,
  entryHtml: string,
): Promise<Zotero.Item> {
  const prev = writes.get(item.id) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      let note = findQaNote(item);
      if (!note) {
        note = new Zotero.Item("note");
        note.libraryID = item.libraryID;
        note.parentID = item.id;
        note.addTag(QA_TAG);
        const meta = paperMeta(item);
        note.setNote(
          qaNoteHtml(
            shortTitle(meta.title, String(item.getField("shortTitle") || "")),
          ),
        );
      }
      note.setNote(appendEntry(note.getNote(), entryHtml));
      await note.saveTx();
      return note;
    });
  writes.set(item.id, next);
  return next;
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
 * The highlight as Zotero's "Add Note from Annotations" renders it: a
 * highlight span (click → PDF location) and a citation. The comment is left
 * out (it holds the @claude lines).
 */
export async function annotationQuoteHtml(
  annotation: Zotero.Item,
): Promise<string> {
  const json: any = await Zotero.Annotations.toJSON(annotation);
  json.attachmentItemID = annotation.parentID;
  json.id = annotation.key;
  json.comment = null;
  const { html } = Zotero.EditorInstanceUtilities.serializeAnnotations([json]);
  return html;
}
