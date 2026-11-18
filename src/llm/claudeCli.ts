// Runs the user's installed official `claude` CLI as a subprocess
// (context.md §3, §5). Never reads ~/.claude credentials and never uses the
// Agent SDK.
//
// Process handling adapted from YufeiXIA/zotero-claude-code
// (addon/content/claude-process.js, store.js), MIT License.

import { getPref } from "../utils/prefs";
import { logged } from "../log";
import type { LogFeature } from "../logFormat";
import { oneShotRunDir } from "../paths";
import {
  absolutePath,
  candidatePaths,
  compareVersions,
  initializeArgs,
  initializeRequest,
  modelsFromControlResponse,
  oneShotArgs,
  parseVersion,
  type ModelInfo,
} from "./claudeArgs";
import {
  claudeErrorText,
  LineBuffer,
  parseJsonLine,
  TurnCollector,
  userMessage,
  type ClaudeErrorKind,
} from "./streamJson";

const { Subprocess } = ChromeUtils.importESModule(
  "resource://gre/modules/Subprocess.sys.mjs",
) as { Subprocess: any };

export class ClaudeError extends Error {
  kind: ClaudeErrorKind;
  constructor(kind: ClaudeErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface ClaudeBinary {
  path: string;
  version: string;
}

let cachedBinary: ClaudeBinary | null = null;

export function resetClaudeBinaryCache() {
  cachedBinary = null;
}

function homeDir(): string {
  return Services.dirsvc.get("Home", Ci.nsIFile).path;
}

/**
 * Starts a binary with its own directory in front of PATH, so an
 * npm-installed claude (`#!/usr/bin/env node`) finds node even when Zotero
 * was launched from Finder (§5.2). With stderr "pipe", stderr is drained into
 * a rolling buffer so the pipe never fills up; await `drained` before reading
 * it after exit.
 */
async function launch(
  path: string,
  args: string[],
  opts: { workdir?: string; stderr: "pipe" | "stdout" },
) {
  const dir = PathUtils.parent(path) || "";
  const proc = await Subprocess.call({
    command: path,
    arguments: args,
    workdir: opts.workdir,
    environment: { PATH: `${dir}:${Services.env.get("PATH") || ""}` },
    environmentAppend: true,
    stderr: opts.stderr,
  });
  const stderr = { text: "" };
  const drained =
    opts.stderr === "pipe"
      ? (async () => {
          let chunk: string;
          try {
            while ((chunk = await proc.stderr.readString())) {
              stderr.text = (stderr.text + chunk).slice(-8000);
            }
          } catch {
            // process gone
          }
        })()
      : Promise.resolve();
  return { proc, stderr, drained };
}

/** Runs `<path> --version` and returns its output (stderr merged). */
async function versionOf(path: string, timeoutMs = 15000): Promise<string> {
  const { proc } = await launch(path, ["--version"], { stderr: "stdout" });
  let out = "";
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    let chunk: string;
    while ((chunk = await proc.stdout.readString())) out += chunk;
    await proc.wait();
  } finally {
    clearTimeout(timer);
  }
  return out.trim();
}

/**
 * Finds the `claude` binary (§5.1). A configured path wins if it runs;
 * otherwise the newest version among the candidates is used. A miss is not
 * cached, so installing claude later works without restarting Zotero.
 */
export async function findClaude(): Promise<ClaudeBinary | null> {
  if (cachedBinary) return cachedBinary;
  const home = homeDir();
  const configured = absolutePath(getPref("claude.path") || "", home);
  const candidates = candidatePaths(
    home,
    Services.env.get("PATH") || "",
    configured ?? "",
  );
  let best: { bin: ClaudeBinary; v: number[] } | null = null;
  for (const path of candidates) {
    let out: string;
    try {
      if (!(await IOUtils.exists(path))) continue;
      out = await versionOf(path);
    } catch (e) {
      ztoolkit.log(`claude candidate failed: ${path}`, e);
      continue;
    }
    const v = parseVersion(out);
    if (!v) continue;
    const bin = { path, version: out };
    if (path === configured) {
      best = { bin, v };
      break;
    }
    if (!best || compareVersions(v, best.v) > 0) best = { bin, v };
  }
  cachedBinary = best?.bin ?? null;
  return cachedBinary;
}

async function requireClaude(): Promise<ClaudeBinary> {
  const bin = await findClaude();
  if (!bin) {
    throw new ClaudeError(
      "not_found",
      "claude CLI를 찾지 못했습니다. 설정에서 경로를 지정하세요.",
    );
  }
  return bin;
}

function stderrTail(text: string): string {
  return text.trim().split("\n").slice(-6).join("\n");
}

// Single-shot calls (and listModels, which shares runs/oneshot) are
// serialized (§4 "호출 직렬화").
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export interface RunOnceOptions {
  /** Full system prompt text (replaces Claude Code's default prompt). */
  systemPrompt: string;
  /** stream-json user message content blocks (text and image). */
  content: unknown[];
  model: string;
  effort?: string;
  timeoutSec: number;
  /** Called with each streamed text chunk. */
  onText?: (delta: string) => void;
  /**
   * Called when the text streamed so far is retracted (safety-classifier
   * stop, then a fallback model starts over). Later onText calls carry the
   * fallback's output.
   */
  onRetract?: () => void;
  /** Called once with the resolved model id (from system/init). */
  onModel?: (model: string) => void;
  /** Called after the process starts with a function that kills it. */
  onStart?: (kill: () => void) => void;
  /** Activity log label (M6). */
  feature: LogFeature;
  /** Extra facts for the activity log. */
  logDetail?: Record<string, string | number | boolean>;
}

export interface RunOnceResult {
  text: string;
  sessionId: string | null;
  /** Resolved model id reported by the CLI, or null. */
  model: string | null;
  /**
   * Set when the safety classifier stopped the first model's output and the
   * CLI retried with a fallback model; `text` is the fallback's output only.
   */
  refusalFallback: { from: string; to: string } | null;
  refusalCategory: string | null;
}

/**
 * One turn, no tools. Rejects with ClaudeError (kind "refusal" when the
 * safety classifier stopped the output and no retry produced one). On timeout the process is
 * killed; text already passed to onText stays delivered.
 */
export function runOnce(o: RunOnceOptions): Promise<RunOnceResult> {
  // Filled in by runOnceInner (Read calls, refusals) before it is logged.
  const detail: Record<string, string | number | boolean> = {
    ...o.logDetail,
  };
  return serialize(() =>
    logged(
      { feature: o.feature, model: o.model, detail },
      () => runOnceInner(o, detail),
      (r) => r.model,
    ),
  );
}

async function runOnceInner(
  o: RunOnceOptions,
  detail: Record<string, string | number | boolean>,
): Promise<RunOnceResult> {
  const bin = await requireClaude();
  const dir = oneShotRunDir();
  await IOUtils.makeDirectory(dir, { createAncestors: true });
  const promptFile = PathUtils.join(dir, "system-prompt.md");
  await IOUtils.writeUTF8(promptFile, o.systemPrompt);

  const args = oneShotArgs({
    model: o.model,
    effort: o.effort,
    systemPromptFile: promptFile,
  });
  const { proc, stderr, drained } = await launch(bin.path, args, {
    workdir: dir,
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, o.timeoutSec * 1000);

  o.onStart?.(() => proc.kill());

  const turn = new TurnCollector();
  const lines = new LineBuffer();
  let modelReported = false;
  const handle = (line: string) => {
    const fallbackBefore = turn.refusalFallback;
    const d = turn.add(parseJsonLine(line));
    if (turn.refusalFallback !== fallbackBefore) o.onRetract?.();
    if (!modelReported && turn.model) {
      modelReported = true;
      o.onModel?.(turn.model);
    }
    if (d && o.onText) o.onText(d);
  };
  try {
    try {
      await proc.stdin.write(userMessage(o.content));
      await proc.stdin.close();
    } catch (e) {
      // claude exited before reading stdin; the stderr tail below explains why.
      ztoolkit.log("claude stdin write failed", e);
    }
    let chunk: string;
    while ((chunk = await proc.stdout.readString())) {
      for (const line of lines.push(chunk)) handle(line);
    }
    const rest = lines.flush();
    if (rest) handle(rest);
    await proc.wait();
    await drained;
  } finally {
    clearTimeout(timer);
  }

  if (turn.reads) detail.reads = turn.reads;
  if (turn.refusalFallback) {
    detail.refusalFallback = `${turn.refusalFallback.from} → ${turn.refusalFallback.to}`;
  }
  if (turn.refusalCategory) detail.refusalCategory = turn.refusalCategory;

  if (timedOut) {
    throw new ClaudeError(
      "timeout",
      `${o.timeoutSec}초 안에 응답이 끝나지 않았습니다.`,
    );
  }
  const err = turn.error();
  if (err) throw new ClaudeError(err.kind, err.message);
  if (!turn.result) {
    throw new ClaudeError(
      "other",
      stderrTail(stderr.text) || "claude가 결과 없이 종료되었습니다.",
    );
  }
  return {
    text: turn.finalText(),
    sessionId: turn.sessionId,
    model: turn.model,
    refusalFallback: turn.refusalFallback,
    refusalCategory: turn.refusalCategory,
  };
}

/** Lists models via the `initialize` control request (§5.3). */
export function listModels(timeoutMs = 20000): Promise<ModelInfo[]> {
  return serialize(async () => {
    const bin = await requireClaude();
    const dir = oneShotRunDir();
    await IOUtils.makeDirectory(dir, { createAncestors: true });
    const { proc, stderr, drained } = await launch(bin.path, initializeArgs(), {
      workdir: dir,
      stderr: "pipe",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
    const lines = new LineBuffer();
    try {
      try {
        await proc.stdin.write(initializeRequest("zca-init"));
      } catch (e) {
        ztoolkit.log("claude stdin write failed", e);
      }
      let chunk: string;
      while ((chunk = await proc.stdout.readString())) {
        for (const line of lines.push(chunk)) {
          const models = modelsFromControlResponse(parseJsonLine(line));
          if (models) return models;
        }
      }
      await drained;
      if (timedOut) {
        throw new ClaudeError(
          "timeout",
          "모델 목록 요청이 시간 안에 끝나지 않았습니다.",
        );
      }
      throw new ClaudeError(
        "other",
        stderrTail(stderr.text) || "모델 목록 응답을 받지 못했습니다.",
      );
    } finally {
      clearTimeout(timer);
      proc.kill();
    }
  });
}

export function errorMessage(e: unknown): string {
  if (e instanceof ClaudeError) return claudeErrorText(e.kind, e.message);
  return String(e);
}

/**
 * Starts a long-lived claude process (sidebar chat). The caller owns the
 * process: it writes stream-json lines to stdin and reads stdout.
 */
export async function launchClaude(args: string[], workdir: string) {
  const bin = await requireClaude();
  return launch(bin.path, args, { workdir, stderr: "pipe" });
}
