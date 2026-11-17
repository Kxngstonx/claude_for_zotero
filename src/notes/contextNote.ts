// Context note: lookup, generation, regeneration, per-item lock
// (context.md §8.2).

import { getPref } from "../utils/prefs";
import { composePrompt, loadPrompt } from "../prompts";
import { runOnce } from "../llm/claudeCli";
import { paperPdf, pdfFullText } from "../pdf/fullText";
import {
  CONTEXT_TAG,
  contextNoteHtml,
  contextNoteUserMessage,
  promptVersion,
  shortTitle,
  type PaperMeta,
} from "./contextNoteFormat";

/** The regular (parent) item for an item or one of its attachments/notes. */
export function paperItem(item: Zotero.Item): Zotero.Item | null {
  if (item.isRegularItem()) return item;
  const parent = item.parentItem;
  return parent && parent.isRegularItem() ? parent : null;
}

/** Child notes of `item` that carry `tag`, newest first. */
export function taggedNotes(item: Zotero.Item, tag: string): Zotero.Item[] {
  return Zotero.Items.get(item.getNotes())
    .filter((n) => n && n.hasTag(tag))
    .sort((a, b) =>
      b.dateModified > a.dateModified
        ? 1
        : b.dateModified < a.dateModified
          ? -1
          : 0,
    );
}

/** The context note; if several exist the newest is used and a warning logged. */
export function findContextNote(item: Zotero.Item): Zotero.Item | null {
  const notes = taggedNotes(item, CONTEXT_TAG);
  if (notes.length > 1) {
    Zotero.debug(
      `[Claude Assist] ${notes.length} context notes on item ${item.key}; using the newest (${notes[0].key})`,
      2,
    );
  }
  return notes[0] ?? null;
}

export function paperMeta(item: Zotero.Item): PaperMeta {
  const field = (f: string) => {
    try {
      return String(item.getField(f) || "");
    } catch {
      return "";
    }
  };
  const authors = item
    .getCreators()
    .map(
      (c: any) =>
        [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name || "",
    )
    .filter(Boolean);
  const date = field("date");
  const year = date ? String(Zotero.Date.strToDate(date).year || "") : "";
  const venue =
    field("publicationTitle") ||
    field("proceedingsTitle") ||
    field("conferenceName") ||
    field("publisher");
  return { title: field("title"), authors, year, venue };
}

export interface GenerateProgress {
  (stage: "text" | "model" | "save", detail?: string): void;
}

// One generation per item at a time; a second request waits for the first.
const inflight = new Map<number, Promise<Zotero.Item>>();

async function generate(
  item: Zotero.Item,
  overwrite: Zotero.Item | null,
  onProgress?: GenerateProgress,
): Promise<Zotero.Item> {
  const pdf = await paperPdf(item);
  if (!pdf) throw new Error("이 항목에 PDF 첨부가 없습니다.");

  onProgress?.("text");
  const { text, pageCount, source } = await pdfFullText(pdf);
  const meta = paperMeta(item);

  // Read once so the recorded version matches the prompt actually sent.
  const mainPrompt = await loadPrompt("context-note.md");
  const rules = await composePrompt(
    "humanize-korean/quick-rules.md",
    "humanize-korean/discourse-patterns.md",
  );
  const system = `${mainPrompt.trim()}\n\n${rules}`;
  const model = getPref("claude.modelNote");
  let received = 0;
  onProgress?.("model", model);
  const res = await runOnce({
    feature: "context-note",
    logDetail: { pages: pageCount },
    systemPrompt: system,
    content: [{ type: "text", text: contextNoteUserMessage(meta, text) }],
    model,
    timeoutSec: Number(getPref("timeout.noteSec")) || 600,
    onText: (d) => {
      received += d.length;
      onProgress?.("model", `${model} · ${received.toLocaleString()}자 수신`);
    },
  });
  const markdown = res.text.trim();
  if (!markdown) throw new Error("모델이 빈 노트를 반환했습니다.");

  onProgress?.("save");
  const html = contextNoteHtml({
    title: shortTitle(meta.title, String(item.getField("shortTitle") || "")),
    model: res.model || model,
    date: new Date(),
    promptVersion: promptVersion(mainPrompt),
    source,
    pageCount,
    markdown,
  });

  // The old note may have been trashed or deleted during generation.
  const target =
    overwrite && !overwrite.deleted && Zotero.Items.get(overwrite.id)
      ? overwrite
      : null;
  const note = target ?? new Zotero.Item("note");
  if (!target) {
    note.libraryID = item.libraryID;
    note.parentID = item.id;
    note.addTag(CONTEXT_TAG);
  }
  note.setNote(html);
  await note.saveTx();
  return note;
}

function start(
  item: Zotero.Item,
  run: () => Promise<Zotero.Item>,
): Promise<Zotero.Item> {
  const p = run().finally(() => {
    if (inflight.get(item.id) === p) inflight.delete(item.id);
  });
  inflight.set(item.id, p);
  return p;
}

export function isGenerating(item: Zotero.Item): boolean {
  return inflight.has(item.id);
}

/** Existing context note, or a newly generated one (lazy generation, §8.2). */
export function ensureContextNote(
  item: Zotero.Item,
  onProgress?: GenerateProgress,
): Promise<Zotero.Item> {
  const running = inflight.get(item.id);
  if (running) return running;
  const existing = findContextNote(item);
  if (existing) return Promise.resolve(existing);
  return start(item, () => generate(item, null, onProgress));
}

/**
 * Generates a new note, overwriting the existing one if there is one. If a
 * generation for this item is running, waits for it and then regenerates.
 */
export function regenerateContextNote(
  item: Zotero.Item,
  onProgress?: GenerateProgress,
): Promise<Zotero.Item> {
  const running = inflight.get(item.id);
  const run = () => generate(item, findContextNote(item), onProgress);
  return start(item, running ? () => running.catch(() => null).then(run) : run);
}
