// Sidebar chat sessions (context.md §10.2, §10.3).
//
// One conversation per paper. A claude process is kept alive between turns
// and stopped after chat.idleMinutes; the next message resumes the session
// with --resume <sessionId>. Session id and messages are stored in
// <data dir>/zotero-claude-assist/chats/<libraryID>-<key>.json.
//
// Working directory: runs/chat-<libraryID>-<key>/sections, holding one file
// per section; the model may Read only there (see chatArgs).

import { getPref } from "../utils/prefs";
import { logged } from "../log";
import { composePrompt } from "../prompts";
import { pluginDataDir } from "../paths";
import { ClaudeError, launchClaude } from "../llm/claudeCli";
import { chatArgs } from "../llm/claudeArgs";
import {
  LineBuffer,
  parseJsonLine,
  TurnCollector,
  userMessage,
} from "../llm/streamJson";
import { ensureContextNote, paperMeta } from "../notes/contextNote";
import { formatPaperMeta } from "../notes/contextNoteFormat";
import { noteHtmlToText } from "../notes/noteText";
import { previousQa } from "../notes/qaNote";
import { paperPdf } from "../pdf/fullText";
import { paperSections, writeSectionFiles } from "../pdf/sections";
import { documentMapText, type Section } from "../pdf/documentMap";
import {
  emptyHistory,
  firstTurnText,
  parseHistory,
  toolStatus,
  type ChatHistory,
  type ChatMessage,
  type Preamble,
} from "./chatFormat";

const TURN_TIMEOUT_SEC = 600;

/** The user stopped the answer. */
export class ChatStopped extends Error {
  constructor() {
    super("답변을 중단했습니다.");
    this.name = "ChatStopped";
  }
}

export interface TurnCallbacks {
  /** Full answer text so far. */
  onDelta?: (text: string) => void;
  /** Short status (preparing, reading a section, …). */
  onStatus?: (text: string) => void;
}

interface PendingTurn {
  /** The process this turn was sent to; only its read loop may settle it. */
  proc: any;
  collector: TurnCollector;
  cb: TurnCallbacks;
  resolve: (r: {
    text: string;
    sessionId: string | null;
    model: string | null;
  }) => void;
  reject: (e: unknown) => void;
}

export class ChatSession {
  readonly itemID: number;
  history: ChatHistory | null = null;
  busy = false;
  private proc: any = null;
  private stderr = { text: "" };
  private turn: PendingTurn | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private sections: Section[] | null = null;
  /** Why the current process is being stopped (null: it ended by itself). */
  private stopReason: "user" | "timeout" | null = null;
  private sectionsWritten = false;
  /** Set by stop("user"); checked between preparation steps of send(). */
  private cancelled = false;
  private loading: Promise<ChatHistory> | null = null;
  private inflight: Promise<unknown> | null = null;
  /** Model and system prompt the running process was started with. */
  private procModel: string | null = null;
  private procPrompt: string | null = null;
  /** Notices that arrived during a send; added after its answer. */
  private deferredNotices: string[] = [];
  private changeListeners = new Set<() => void>();

  /** Subscribes to history changes (any saved change); returns unsubscribe. */
  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  constructor(item: Zotero.Item) {
    this.itemID = item.id;
  }

  private item(): Zotero.Item {
    const item = Zotero.Items.get(this.itemID);
    if (!item) throw new Error("논문 항목을 찾을 수 없습니다.");
    return item;
  }

  private paths() {
    const item = this.item();
    const key = `${item.libraryID}-${item.key}`;
    const base = PathUtils.join(pluginDataDir(), "runs", `chat-${key}`);
    return {
      base,
      cwd: PathUtils.join(base, "sections"),
      promptFile: PathUtils.join(base, "system-prompt.md"),
      historyFile: PathUtils.join(pluginDataDir(), "chats", `${key}.json`),
    };
  }

  /** The stored history (one shared object; concurrent first calls share one read). */
  load(): Promise<ChatHistory> {
    if (this.history) return Promise.resolve(this.history);
    if (!this.loading) {
      const { historyFile } = this.paths();
      this.loading = (async () => {
        const text = (await IOUtils.exists(historyFile))
          ? await IOUtils.readUTF8(historyFile)
          : null;
        this.history ??= parseHistory(text);
        return this.history;
      })().finally(() => (this.loading = null));
    }
    return this.loading;
  }

  private async save(): Promise<void> {
    const { historyFile } = this.paths();
    await IOUtils.makeDirectory(PathUtils.parent(historyFile)!, {
      createAncestors: true,
    });
    await IOUtils.writeUTF8(
      historyFile,
      JSON.stringify(this.history ?? emptyHistory()),
    );
    for (const fn of this.changeListeners) {
      try {
        fn();
      } catch (e) {
        Zotero.debug(`[Claude Assist] chat listener failed: ${e}`);
      }
    }
  }

  get running(): boolean {
    return !!this.proc;
  }

  // ---------------------------------------------------------------- context

  private async loadSections(): Promise<Section[]> {
    if (this.sections) return this.sections;
    const pdf = await paperPdf(this.item());
    if (!pdf) throw new Error("이 항목에 PDF 첨부가 없습니다.");
    this.sections = await paperSections(pdf);
    return this.sections;
  }

  private async ensureSectionFiles(cb: TurnCallbacks): Promise<void> {
    if (this.sectionsWritten) return;
    cb.onStatus?.("섹션 파일 준비 중…");
    await writeSectionFiles(this.paths().cwd, await this.loadSections());
    this.sectionsWritten = true;
  }

  private async preamble(cb: TurnCallbacks): Promise<Preamble> {
    const item = this.item();
    cb.onStatus?.("컨텍스트 노트 확인 중…");
    const note = await ensureContextNote(item, (stage, detail) =>
      cb.onStatus?.(
        stage === "model"
          ? `컨텍스트 노트가 없어 먼저 생성하는 중… (${detail ?? ""})`
          : "컨텍스트 노트 준비 중…",
      ),
    );
    return {
      paperMeta: formatPaperMeta(paperMeta(item)),
      contextNote: noteHtmlToText(note.getNote()),
      documentMap: documentMapText(await this.loadSections()),
      previousQa: previousQa(item),
    };
  }

  // ---------------------------------------------------------------- process

  private async ensureProcess(
    resume: string | null,
    prompt: string,
  ): Promise<void> {
    if (this.proc) return;
    const { base, cwd, promptFile } = this.paths();
    await IOUtils.makeDirectory(base, { createAncestors: true });
    await IOUtils.writeUTF8(promptFile, prompt);
    const model = getPref("claude.modelAnswer");
    const args = chatArgs({ model, systemPromptFile: promptFile, resume });
    const { proc, stderr } = await launchClaude(args, cwd);
    this.proc = proc;
    this.procModel = model;
    this.procPrompt = prompt;
    this.stderr = stderr;
    void this.readLoop(proc);
  }

  private async readLoop(proc: any): Promise<void> {
    const lines = new LineBuffer();
    let received = 0;
    let loopError: unknown = null;
    const handle = (line: string) => {
      received++;
      const ev = parseJsonLine(line);
      const t = this.turn;
      if (!ev || !t || t.proc !== proc) return;
      const status = toolStatus(ev);
      if (status) t.cb.onStatus?.(status);
      // Compare text, not the delta: a refusal fallback clears the retracted
      // answer, and the view must drop it too.
      const before = t.collector.text;
      t.collector.add(ev);
      if (t.collector.text !== before) t.cb.onDelta?.(t.collector.text);
      if (ev.type === "result") this.finishTurn();
    };
    try {
      let chunk: string;
      while ((chunk = await proc.stdout.readString())) {
        for (const line of lines.push(chunk)) handle(line);
      }
      const rest = lines.flush();
      if (rest) handle(rest);
    } catch (e) {
      loopError = e;
      Zotero.debug(`[Claude Assist] chat read loop ended: ${e}`);
    }
    let exitCode: unknown = "?";
    try {
      exitCode = (await proc.wait()).exitCode;
    } catch {
      // unknown
    }
    if (this.proc === proc) this.proc = null;
    // A stopped process's loop can end after a new process took over: only
    // settle a turn that was sent to this process.
    const t = this.turn;
    if (t && t.proc === proc) {
      this.turn = null;
      if (this.stopReason === "user") {
        t.reject(new ChatStopped());
      } else if (this.stopReason === "timeout") {
        t.reject(
          new ClaudeError(
            "timeout",
            `${TURN_TIMEOUT_SEC}초 안에 답변이 끝나지 않았습니다.`,
          ),
        );
      } else {
        const tail = this.stderr.text.trim().split("\n").slice(-6).join("\n");
        const info = `대화 프로세스가 종료되었습니다 (exit ${exitCode}, 출력 ${received}줄${loopError ? `, ${loopError}` : ""}).`;
        t.reject(new ClaudeError("other", tail ? `${tail}\n${info}` : info));
      }
    }
  }

  private finishTurn() {
    const t = this.turn;
    if (!t) return;
    this.turn = null;
    const err = t.collector.error();
    // result.result is the final assistant message only, without narration
    // written before Read calls ("Let me read the method section.").
    const r = t.collector.result;
    const finalText =
      typeof r?.result === "string" && r.result.trim()
        ? r.result
        : t.collector.finalText();
    if (err) t.reject(new ClaudeError(err.kind, err.message));
    else
      t.resolve({
        text: finalText,
        sessionId: t.collector.sessionId,
        model: t.collector.model,
      });
  }

  private loggedTurn(
    content: string,
    cb: TurnCallbacks,
    resume: string | null,
  ) {
    return logged(
      {
        feature: "chat",
        model: getPref("claude.modelAnswer"),
        detail: { resumed: !!resume },
      },
      () => this.runTurn(content, cb, resume),
      (r) => r.model,
    );
  }

  private async runTurn(
    content: string,
    cb: TurnCallbacks,
    resume: string | null,
  ) {
    // Edited prompt files and a changed model apply from the next message:
    // relaunch (the conversation resumes; see chatArgs on prompt snapshots).
    const prompt = await composePrompt("sidebar-chat.md", "humanize-digest.md");
    if (
      this.proc &&
      (this.procModel !== getPref("claude.modelAnswer") ||
        this.procPrompt !== prompt)
    ) {
      this.stop("internal");
    }
    await this.ensureProcess(resume, prompt);
    if (this.cancelled) {
      this.stop("internal");
      throw new ChatStopped();
    }
    const proc = this.proc;
    this.stopReason = null;
    const timer = setTimeout(
      () => this.stop("timeout"),
      TURN_TIMEOUT_SEC * 1000,
    );
    try {
      return await new Promise<{
        text: string;
        sessionId: string | null;
        model: string | null;
      }>((resolve, reject) => {
        this.turn = {
          proc,
          collector: new TurnCollector(),
          cb,
          resolve,
          reject,
        };
        proc.stdin
          .write(userMessage([{ type: "text", text: content }]))
          .catch((e: unknown) => {
            this.turn = null;
            reject(e);
          });
      });
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------- public

  /** Sends a message; resolves with the stored assistant message. */
  async send(text: string, cb: TurnCallbacks = {}): Promise<ChatMessage> {
    if (this.busy)
      throw new Error("이전 메시지에 대한 답변을 기다리는 중입니다.");
    this.busy = true;
    this.cancelled = false;
    this.clearIdle();
    const run = this.sendInner(text, cb);
    this.inflight = run;
    try {
      return await run;
    } finally {
      this.inflight = null;
      this.busy = false;
      this.armIdle();
      if (this.deferredNotices.length) {
        const notices = this.deferredNotices.splice(0);
        void (async () => {
          for (const t of notices) await this.addNotice(t);
        })();
      }
    }
  }

  private async sendInner(
    text: string,
    cb: TurnCallbacks,
  ): Promise<ChatMessage> {
    const check = () => {
      if (this.cancelled) throw new ChatStopped();
    };
    const h = await this.load();
    h.messages.push({ role: "user", text, at: new Date().toISOString() });
    await this.save();
    await this.ensureSectionFiles(cb);
    check();

    let result;
    if (h.sessionId) {
      try {
        cb.onStatus?.("답변 중…");
        result = await this.loggedTurn(text, cb, h.sessionId);
      } catch (e) {
        // Only a session that no longer exists starts over (with the full
        // context); other errors keep the session for the next message.
        if (
          !(e instanceof ClaudeError) ||
          !/No conversation found/i.test(e.message)
        ) {
          throw e;
        }
        this.stop("internal");
        h.sessionId = null;
        h.messages.push({
          role: "notice",
          text: "이전 대화를 이어갈 수 없어 새 대화로 시작했습니다.",
          at: new Date().toISOString(),
        });
      }
    }
    if (!result) {
      const pre = await this.preamble(cb);
      check();
      cb.onStatus?.("답변 중…");
      result = await this.loggedTurn(firstTurnText(pre, text), cb, null);
    }
    if (result.sessionId) h.sessionId = result.sessionId;
    const msg: ChatMessage = {
      role: "assistant",
      text: result.text,
      at: new Date().toISOString(),
      model: result.model ?? undefined,
    };
    h.messages.push(msg);
    await this.save();
    return msg;
  }

  /** Adds an information line (not sent to the model). */
  async addNotice(text: string): Promise<void> {
    // Keep a question and its answer together: add after the running send.
    if (this.busy) {
      this.deferredNotices.push(text);
      return;
    }
    const h = await this.load();
    h.messages.push({ role: "notice", text, at: new Date().toISOString() });
    await this.save();
  }

  /** Records that message `index` was saved to the Q&A note. */
  async markSaved(index: number): Promise<void> {
    const h = await this.load();
    if (h.messages[index]) h.messages[index].savedAt = new Date().toISOString();
    await this.save();
  }

  /**
   * Stops the process; an unfinished answer is discarded. "user": the turn
   * ends with ChatStopped; "timeout": with a timeout error; "internal": no
   * turn is pending (idle, reset, fallback).
   */
  stop(reason: "user" | "timeout" | "internal" = "user"): void {
    const proc = this.proc;
    if (reason === "user" && this.busy) this.cancelled = true;
    this.stopReason = reason === "internal" ? null : reason;
    this.proc = null;
    try {
      proc?.kill();
    } catch {
      // already gone
    }
  }

  /** Starts a new conversation (history cleared, section files rebuilt). */
  async reset(): Promise<void> {
    this.stop("user");
    // Let an in-flight send finish (it ends with ChatStopped) before the
    // history object is replaced, so it cannot write into the new one.
    await this.inflight?.catch(() => undefined);
    this.clearIdle();
    this.history = emptyHistory();
    this.sections = null;
    this.sectionsWritten = false;
    await this.save();
  }

  private clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private armIdle() {
    this.clearIdle();
    const minutes = Math.max(1, Number(getPref("chat.idleMinutes")) || 15);
    this.idleTimer = setTimeout(() => {
      if (this.busy) return;
      this.stop("internal");
      this.sections = null; // files stay on disk; free the text in memory
    }, minutes * 60_000);
  }

  dispose() {
    this.clearIdle();
    this.stop("user");
  }
}

const sessions = new Map<number, ChatSession>();

export function chatSession(item: Zotero.Item): ChatSession {
  let s = sessions.get(item.id);
  if (!s) {
    s = new ChatSession(item);
    sessions.set(item.id, s);
  }
  return s;
}

export function shutdownChats(): void {
  for (const s of sessions.values()) s.dispose();
  sessions.clear();
}
