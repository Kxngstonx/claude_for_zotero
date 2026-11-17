// Read-only Q&A note editors while a memo batch writes to the note
// (user decision 2026-11-17, see docs/decisions.md).
//
// Zotero's note editor applies external saves to an open editor, but text
// typed in the editor just before our append was lost. So while a batch runs,
// every open editor showing the Q&A note is:
//   1. flushed: its unsaved content is saved (EditorInstance.saveSync) and we
//      wait until that save is in the database,
//   2. reloaded read-only (note-editor element: mode = "view", initEditor()),
//   3. reloaded now and then so new answers show up (a read-only editor
//      ignores external changes; throttled so the view does not jump on
//      every answer),
//   4. reloaded editable when the batch ends.
// Editors reused for other notes (item pane, reader context pane) are only
// touched while they still show this note.
// Uses the note-editor element's mode/initEditor/getCurrentInstance and the
// editor registry Zotero.Notes._editorInstances (private, Zotero 10.0.9).

type NoteEditorElement = {
  mode: string;
  isConnected: boolean;
  item?: Zotero.Item;
  initEditor: () => Promise<void>;
  getCurrentInstance?: () => any;
};

const FLUSH_TIMEOUT_MS = 3000;
const REFRESH_INTERVAL_MS = 5000;

// noteID → editor elements this module switched to view mode.
const locked = new Map<number, Set<NoteEditorElement>>();
const lastRefresh = new Map<number, number>();
// Editor instance → its note-editor element (chrome DOM: identity is stable).
const elementOf = new WeakMap<object, NoteEditorElement>();

function showsNote(el: NoteEditorElement, noteID: number): boolean {
  return el.isConnected && el.item?.id === noteID;
}

/** All note-editor elements in every open window, including shadow roots. */
function allNoteEditorElements(): NoteEditorElement[] {
  const out: NoteEditorElement[] = [];
  const visit = (root: Document | ShadowRoot) => {
    out.push(...(Array.from(root.querySelectorAll("note-editor")) as any[]));
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if ((el as Element).shadowRoot) visit((el as Element).shadowRoot!);
    }
  };
  const windows = Services.wm.getEnumerator(null as any); // null: all window types
  while (windows.hasMoreElements()) {
    const win = windows.getNext() as Window;
    if (win.document) visit(win.document);
  }
  return out;
}

// The editor's iframe is a content frame, so frameElement is null from
// chrome code; elements are found by searching windows (only when an editor
// instance is not mapped yet) and matched by getCurrentInstance().
function openEditors(
  noteID: number,
): Array<{ inst: any; el: NoteEditorElement }> {
  const instances: any[] = (
    (Zotero.Notes as any)._editorInstances ?? []
  ).filter((inst: any) => inst?._item?.id === noteID);
  if (!instances.length) return [];
  if (instances.some((inst) => !elementOf.get(inst)?.isConnected)) {
    for (const el of allNoteEditorElements()) {
      const inst = el.getCurrentInstance?.();
      if (inst) elementOf.set(inst, el);
    }
  }
  const out: Array<{ inst: any; el: NoteEditorElement }> = [];
  for (const inst of instances) {
    const el = elementOf.get(inst);
    if (el && el.getCurrentInstance?.() === inst) out.push({ inst, el });
  }
  return out;
}

function currentHtml(noteID: number): string {
  const note = Zotero.Items.get(noteID);
  return note ? note.getNote() : "";
}

/** Saves the editor's unsaved content and waits until it is in the database. */
async function flush(inst: any, noteID: number): Promise<void> {
  let pending: string | null = null;
  try {
    pending =
      inst._iframeWindow?.wrappedJSObject?.getDataSync?.(true)?.html ?? null;
  } catch {
    // editor not ready
  }
  const before = currentHtml(noteID);
  if (pending === null || pending === before) return; // nothing unsaved
  try {
    inst.saveSync();
  } catch (e) {
    Zotero.debug(`[Claude Assist] note flush failed: ${e}`);
    return;
  }
  const until = Date.now() + FLUSH_TIMEOUT_MS;
  while (Date.now() < until) {
    await Zotero.Promise.delay(50);
    const now = currentHtml(noteID);
    if (now !== before) return;
  }
  Zotero.debug(
    `[Claude Assist] note flush not confirmed within ${FLUSH_TIMEOUT_MS} ms`,
  );
}

/**
 * Makes every open editor that shows the note and is editable read-only.
 * Safe to call repeatedly: editors opened (or switched back to this note)
 * later are locked on the next call.
 */
export async function lockNoteEditors(noteID: number): Promise<void> {
  const set = locked.get(noteID) ?? new Set<NoteEditorElement>();
  locked.set(noteID, set);
  for (const { inst, el } of openEditors(noteID)) {
    if (el.mode !== "edit" || !showsNote(el, noteID)) continue;
    await flush(inst, noteID);
    set.add(el);
    el.mode = "view";
    await el.initEditor();
  }
}

/**
 * Reloads locked editors that still show the note, at most every few
 * seconds unless `force` (new answers show up; the view does not jump on
 * every answer).
 */
export async function refreshLockedEditors(
  noteID: number,
  force = false,
): Promise<void> {
  const now = Date.now();
  if (!force && now - (lastRefresh.get(noteID) ?? 0) < REFRESH_INTERVAL_MS)
    return;
  lastRefresh.set(noteID, now);
  for (const el of locked.get(noteID) ?? []) {
    if (showsNote(el, noteID) && el.mode === "view") await el.initEditor();
  }
}

/** Restores the editors this module locked (those still showing the note). */
export async function unlockNoteEditors(noteID: number): Promise<void> {
  const set = locked.get(noteID);
  locked.delete(noteID);
  lastRefresh.delete(noteID);
  const note = Zotero.Items.get(noteID) as Zotero.Item | false;
  const editable = !!note && note.isEditable();
  for (const el of set ?? []) {
    if (!showsNote(el, noteID) || el.mode !== "view") continue;
    try {
      el.mode = editable ? "edit" : "view";
      await el.initEditor();
    } catch (e) {
      Zotero.debug(`[Claude Assist] note unlock failed: ${e}`);
    }
  }
}

export function isLocked(noteID: number): boolean {
  return (locked.get(noteID)?.size ?? 0) > 0;
}
