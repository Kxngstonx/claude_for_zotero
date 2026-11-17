// Feature 3: answer pending "@claude" memo questions in one batch and append
// the answers to the paper's Q&A note (context.md §9).
//
// Write order per answer: append to the Q&A note → on success mark the memo
// line "@claude ✓". The model never writes; this code does (§2).

import { getPref } from "../utils/prefs";
import { composePrompt } from "../prompts";
import { ClaudeError, errorMessage, runOnce } from "../llm/claudeCli";
import { ensureContextNote, paperMeta } from "../notes/contextNote";
import { formatPaperMeta } from "../notes/contextNoteFormat";
import { noteHtmlToText } from "../notes/noteText";
import {
  annotationQuoteHtml,
  appendQaEntry,
  findQaNote,
  previousQa,
} from "../notes/qaNote";
import { hasAnnRef, qaEntryHtml } from "../notes/qaFormat";
import { markAnswered, pendingQuestions } from "../memo/memoSyntax";
import {
  AnswerStream,
  buildMemoContent,
  memoTimeoutSec,
  splitBatches,
  type MemoQuestion,
  type QuestionKind,
} from "../memo/batch";
import {
  annotationSurrounding,
  closeTabs,
  type PagesCache,
  type Surrounding,
} from "../pdf/annotationContext";

export interface MemoBatchUI {
  stage(text: string): void;
  progress(done: number, total: number): void;
}

export interface MemoFailure {
  question: string;
  pageLabel: string;
  reason: string;
}

export interface MemoBatchResult {
  total: number;
  answered: number;
  failures: MemoFailure[];
  /** Answered and saved, but the memo line could not be marked ✓. */
  warnings: MemoFailure[];
  /** Image questions found but not handled in this milestone (M4). */
  skippedImages: number;
  qaNoteID: number | null;
}

/** Test-only hooks. */
export interface MemoBatchHooks {
  /** Kill the claude process once this many answers arrived (first call only). */
  killAfterAnswers?: number;
}

const TEXT_KINDS = new Set(["highlight", "underline"]);

interface Pending {
  annotation: Zotero.Item;
  attachment: Zotero.Item;
  line: number;
  question: string;
}

/** Pending questions of all PDF attachments, in paper order (§9.2 step 2). */
export function collectPending(item: Zotero.Item): {
  pending: Pending[];
  skippedImages: number;
} {
  const pending: Pending[] = [];
  let skippedImages = 0;
  for (const id of item.getAttachments()) {
    const attachment = Zotero.Items.get(id);
    if (!attachment || !attachment.isPDFAttachment()) continue;
    const anns = attachment
      .getAnnotations()
      .slice()
      .sort((a: Zotero.Item, b: Zotero.Item) =>
        (a.annotationSortIndex || "").localeCompare(
          b.annotationSortIndex || "",
        ),
      );
    for (const annotation of anns) {
      const qs = pendingQuestions(annotation.annotationComment);
      if (!qs.length) continue;
      if (annotation.annotationType === "image") {
        skippedImages += qs.length;
        continue;
      }
      if (!TEXT_KINDS.has(annotation.annotationType)) continue;
      for (const q of qs) pending.push({ annotation, attachment, ...q });
    }
  }
  return { pending, skippedImages };
}

// One batch per paper at a time.
const running = new Set<number>();

export function isMemoBatchRunning(item: Zotero.Item): boolean {
  return running.has(item.id);
}

const STOP_KINDS = new Set(["auth", "limit", "not_found", "model"]);

export async function runMemoBatch(
  item: Zotero.Item,
  ui: MemoBatchUI,
  hooks: MemoBatchHooks = {},
): Promise<MemoBatchResult> {
  if (running.has(item.id))
    throw new Error("이 논문의 메모 처리가 이미 진행 중입니다.");
  running.add(item.id);
  const opened = new Set<string>();
  try {
    const { pending, skippedImages } = collectPending(item);
    const result: MemoBatchResult = {
      total: pending.length,
      answered: 0,
      failures: [],
      warnings: [],
      skippedImages,
      qaNoteID: findQaNote(item)?.id ?? null,
    };
    if (!pending.length) return result;
    if (!item.library.editable)
      throw new Error("편집 권한이 없는 라이브러리입니다.");

    ui.stage("컨텍스트 노트 확인 중…");
    const contextNote = await ensureContextNote(item, (stage, detail) =>
      ui.stage(
        stage === "model"
          ? `컨텍스트 노트가 없어 먼저 생성하는 중… (${detail ?? ""})`
          : "컨텍스트 노트 준비 중…",
      ),
    );

    ui.stage("하이라이트 주변 문단 준비 중…");
    const n = Math.max(0, Number(getPref("memo.surroundingParagraphs")) || 0);
    const questions: MemoQuestion[] = [];
    const byRef = new Map<string, Pending>();
    const surroundings = new Map<string, Surrounding>();
    const pagesCache: PagesCache = new Map();
    for (const p of pending) {
      const pos = JSON.parse(p.annotation.annotationPosition || "{}");
      let sur = surroundings.get(p.annotation.key);
      if (!sur) {
        sur = await annotationSurrounding(
          p.annotation,
          p.attachment,
          n,
          opened,
          pagesCache,
        );
        surroundings.set(p.annotation.key, sur);
      }
      const ref = `${p.annotation.key}#${p.line}`;
      byRef.set(ref, p);
      questions.push({
        ref,
        annotationKey: p.annotation.key,
        attachmentID: p.attachment.id,
        line: p.line,
        question: p.question,
        kind: p.annotation.annotationType as QuestionKind,
        pageLabel:
          p.annotation.annotationPageLabel || String((pos.pageIndex ?? 0) + 1),
        pageIndex: pos.pageIndex ?? 0,
        highlight: p.annotation.annotationText || "",
        surrounding: sur.text,
        approx: sur.approx,
      });
    }
    closeTabs(opened);

    const system = await composePrompt("memo-batch.md", "humanize-digest.md");
    const shared = {
      paperMeta: formatPaperMeta(paperMeta(item)),
      contextNote: noteHtmlToText(contextNote.getNote()),
      previousQa: previousQa(item),
    };
    const model = getPref("claude.modelAnswer");
    let done = 0;
    ui.progress(0, questions.length);

    const fail = (q: MemoQuestion, reason: string) =>
      result.failures.push({
        question: q.question,
        pageLabel: q.pageLabel,
        reason,
      });

    const warn = (q: MemoQuestion, reason: string) =>
      result.warnings.push({
        question: q.question,
        pageLabel: q.pageLabel,
        reason,
      });

    // Appends one answer (throws if that fails), then marks the memo line.
    // A marking problem is a warning: the answer is already saved.
    const commit = async (
      q: MemoQuestion,
      answer: string,
      usedModel: string,
    ) => {
      const p = byRef.get(q.ref)!;
      const before = findQaNote(item)?.getNote() ?? "";
      const note = await appendQaEntry(
        item,
        qaEntryHtml({
          quoteHtml: await annotationQuoteHtml(p.annotation),
          question: q.question,
          answerMarkdown: answer,
          meta: {
            pageLabel: q.pageLabel,
            date: new Date(),
            model: usedModel,
            annotationKey: q.annotationKey,
            line: q.line,
            reasked: hasAnnRef(before, q.annotationKey, q.line),
          },
        }),
      );
      result.qaNoteID = note.id;
      done++;
      result.answered++;
      ui.progress(done, questions.length);

      const ann = Zotero.Items.get(p.annotation.id) || null;
      const original = ann ? ann.annotationComment || "" : "";
      const marked = ann ? markAnswered(original, q.line, q.question) : null;
      if (marked === null) {
        warn(
          q,
          "메모가 바뀌어 ✓ 표시를 하지 못했습니다. 다시 실행하면 재질문으로 기록됩니다.",
        );
        return;
      }
      try {
        ann!.annotationComment = marked;
        await ann!.saveTx();
      } catch (e) {
        ann!.annotationComment = original; // drop the unsaved change
        warn(q, `✓ 표시 저장 실패: ${e}`);
      }
    };

    // One claude call; answers are committed line by line as they arrive.
    const call = async (batch: MemoQuestion[], killAfter?: number) => {
      const ids = batch.map((_, i) => `q${i + 1}`);
      const byId = new Map(ids.map((id, i) => [id, batch[i]]));
      const stream = new AnswerStream(ids);
      const answered = new Set<string>();
      let usedModel = model;
      let kill: (() => void) | null = null;
      let chain: Promise<void> = Promise.resolve();
      let received = 0;
      const take = (xs: Array<{ id: string; answer: string }>) => {
        for (const { id, answer } of xs) {
          received++;
          if (killAfter !== undefined && received >= killAfter) kill?.();
          const q = byId.get(id)!;
          chain = chain.then(async () => {
            try {
              await commit(q, answer, usedModel);
              answered.add(q.ref);
            } catch (e) {
              fail(q, `질문 노트 저장 실패: ${e}`);
              answered.add(q.ref); // do not ask again: may already be in the note
            }
          });
        }
      };
      let error: unknown = null;
      try {
        await runOnce({
          systemPrompt: system,
          content: buildMemoContent({
            ...shared,
            questions: batch.map((q, i) => ({ id: ids[i], q })),
          }),
          model,
          timeoutSec: memoTimeoutSec(
            batch.length,
            Number(getPref("timeout.memoBaseSec")) || 60,
            Number(getPref("timeout.memoPerQuestionSec")) || 30,
          ),
          onModel: (m) => (usedModel = m),
          onStart: (k) => (kill = k),
          onText: (d) => take(stream.push(d)),
        });
      } catch (e) {
        error = e;
      }
      take(stream.end());
      await chain;
      return { missing: batch.filter((q) => !answered.has(q.ref)), error };
    };

    const batches = splitBatches(
      questions,
      Math.max(1, Number(getPref("memo.maxQuestionsPerCall")) || 30),
      Math.max(0, Number(getPref("memo.maxImagesPerCall")) || 0),
    );
    let stopped: string | null = null;
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      if (stopped) {
        batch.forEach((q) => fail(q, stopped!));
        continue;
      }
      ui.stage(
        batches.length > 1
          ? `Claude 답변 중… (${b + 1}/${batches.length}번째 호출)`
          : "Claude 답변 중…",
      );
      const first = await call(
        batch,
        b === 0 ? hooks.killAfterAnswers : undefined,
      );
      if (!first.missing.length) continue;
      const err = first.error instanceof ClaudeError ? first.error : null;
      if (err && STOP_KINDS.has(err.kind)) {
        // Usage limit, login, missing CLI or bad model: no retry (§9.4).
        stopped = errorMessage(err);
        first.missing.forEach((q) => fail(q, stopped!));
        continue;
      }
      if (err?.kind === "timeout") {
        // Likely to time out again: no retry (§9.4).
        first.missing.forEach((q) => fail(q, errorMessage(err)));
        continue;
      }
      ui.stage(`답을 받지 못한 ${first.missing.length}개 질문 다시 요청 중…`);
      const second = await call(first.missing);
      const err2 = second.error instanceof ClaudeError ? second.error : null;
      if (err2 && STOP_KINDS.has(err2.kind)) stopped = errorMessage(err2);
      const reason = second.error
        ? errorMessage(second.error)
        : "모델 응답에 이 질문의 답이 없었습니다.";
      second.missing.forEach((q) => fail(q, reason));
    }
    return result;
  } finally {
    closeTabs(opened);
    running.delete(item.id);
  }
}
