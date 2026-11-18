// Pure helpers for locating and invoking the `claude` CLI. No Zotero globals.

/** Expands a leading `~/`; returns null for paths that are not absolute. */
export function absolutePath(p: string, home: string): string | null {
  const t = p.trim();
  const expanded = t.startsWith("~/") ? `${home}/${t.slice(2)}` : t;
  return expanded.startsWith("/") ? expanded : null;
}

/**
 * Candidate binary paths in priority order (context.md §5.1). The configured
 * path, if any, comes first. Relative entries (e.g. "." in PATH) are dropped
 * because IOUtils rejects them. Duplicates are removed.
 */
export function candidatePaths(
  home: string,
  pathEnv: string,
  configured?: string,
): string[] {
  const list = [
    configured?.trim() || "",
    `${home}/.local/bin/claude`,
    `${home}/.claude/local/claude`,
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "/usr/bin/claude",
    ...pathEnv
      .split(":")
      .filter(Boolean)
      .map((d) => `${d.replace(/\/+$/, "")}/claude`),
  ];
  const abs = list
    .map((p) => absolutePath(p, home))
    .filter((p): p is string => !!p);
  return [...new Set(abs)];
}

export function parseVersion(text: string): number[] | null {
  const m = String(text).match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1).map(Number) : null;
}

export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export interface OneShotArgs {
  model: string;
  systemPromptFile: string;
  effort?: string;
  /**
   * Allow the Read tool in the working directory only, which then holds
   * the paper's section files (memo answers that need the paper's text).
   * Confined twice over, as in chatArgs: --restricted keeps file tools in
   * the working directory (a path rule alone does not: with dontAsk a
   * sibling file of ./sections/ was readable, claude 2.1.327).
   */
  readSections?: boolean;
}

/**
 * argv for a single-turn call with no tools, or only Read in the working
 * directory (note generation, memo batch, connection test). The default Claude Code system prompt is replaced, and the
 * user's ~/.claude settings, MCP servers, skills and slash commands are not
 * loaded (verified via the system/init event: tools, mcp_servers, skills and
 * slash_commands are all empty).
 */
export function oneShotArgs(o: OneShotArgs): string[] {
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--setting-sources",
    "local",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
    ...(o.readSections
      ? ["--restricted", "--tools", "Read", "--allowedTools", "Read(./**)"]
      : ["--tools", ""]),
    "--system-prompt-file",
    o.systemPromptFile,
    "--model",
    o.model,
  ];
  if (o.effort) args.push("--effort", o.effort);
  return args;
}

/** argv for listing models via the `initialize` control request. */
export function initializeArgs(): string[] {
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--setting-sources",
    "local",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--tools",
    "",
  ];
}

export function initializeRequest(id: string): string {
  return (
    JSON.stringify({
      type: "control_request",
      request_id: id,
      request: { subtype: "initialize" },
    }) + "\n"
  );
}

export interface ModelInfo {
  value: string;
  displayName?: string;
  description?: string;
  resolvedModel?: string;
}

/** Extracts the model list from a control_response event, or null. */
export function modelsFromControlResponse(ev: any): ModelInfo[] | null {
  if (ev?.type !== "control_response") return null;
  const r = ev.response;
  if (r?.subtype === "error") throw new Error(r.error || "initialize failed");
  const models = r?.response?.models;
  return Array.isArray(models) ? models : [];
}

export interface ChatArgs {
  model: string;
  systemPromptFile: string;
  resume?: string | null;
  effort?: string;
}

/**
 * argv for a sidebar chat session (context.md §10): stream-json in/out,
 * streamed partial messages, persisted session (for --resume), and only the
 * Read tool confined to the working directory (the paper's section files).
 * Reads outside it are denied twice over: --restricted confines file tools
 * to the working directory, and the allow rule is path-scoped (a bare
 * "Read" rule allowed reading anywhere — verified with claude 2.1.326).
 */
export function chatArgs(o: ChatArgs): string[] {
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--setting-sources",
    "local",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--restricted",
    "--permission-mode",
    "dontAsk",
    "--tools",
    "Read",
    "--allowedTools",
    "Read(./**)",
    "--system-prompt-file",
    o.systemPromptFile,
    // The CLI records the system prompt per conversation by default and
    // reuses it on resume; off makes an edited prompt file apply to the
    // resumed conversation too (M6).
    "--system-prompt-snapshot",
    "off",
    "--model",
    o.model,
  ];
  if (o.effort) args.push("--effort", o.effort);
  if (o.resume) args.push("--resume", o.resume);
  return args;
}
