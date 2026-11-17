// Activity log: <data dir>/zotero-claude-assist/logs/activity.jsonl, one JSON
// line per Claude/Gemini call (metadata only), rotated to activity.1.jsonl at
// 1 MB. Logging never throws into the caller.

import { pluginDataDir } from "./paths";
import { formatLogLine, LOG_MAX_BYTES, type LogEntry } from "./logFormat";

export function logDir(): string {
  return PathUtils.join(pluginDataDir(), "logs");
}

export function logFile(): string {
  return PathUtils.join(logDir(), "activity.jsonl");
}

let chain: Promise<void> = Promise.resolve();

export function logActivity(entry: LogEntry): Promise<void> {
  chain = chain
    .then(async () => {
      await IOUtils.makeDirectory(logDir(), { createAncestors: true });
      const file = logFile();
      if (await IOUtils.exists(file)) {
        const { size } = await IOUtils.stat(file);
        if ((size ?? 0) >= LOG_MAX_BYTES) {
          await IOUtils.move(
            file,
            PathUtils.join(logDir(), "activity.1.jsonl"),
          );
        }
      }
      await IOUtils.writeUTF8(file, formatLogLine(entry), {
        mode: "appendOrCreate",
      });
    })
    .catch((e) => Zotero.debug(`[Claude Assist] activity log failed: ${e}`));
  return chain;
}

/** Times `fn` and logs its outcome under `feature`. */
export async function logged<T>(
  entry: Omit<LogEntry, "ok" | "ms">,
  fn: () => Promise<T>,
  modelOf?: (r: T) => string | null | undefined,
): Promise<T> {
  const start = Date.now();
  try {
    const r = await fn();
    void logActivity({
      ...entry,
      ok: true,
      ms: Date.now() - start,
      model: modelOf?.(r) ?? entry.model,
    });
    return r;
  } catch (e: any) {
    void logActivity({
      ...entry,
      ok: false,
      ms: Date.now() - start,
      // A user stop is not a failure of the call.
      kind: e?.kind ?? (e?.name === "ChatStopped" ? "stopped" : undefined),
      error: e?.message ?? String(e),
    });
    throw e;
  }
}
