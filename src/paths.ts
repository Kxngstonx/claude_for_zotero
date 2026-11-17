/** <Zotero data directory>/zotero-claude-assist */
export function pluginDataDir(): string {
  return PathUtils.join(Zotero.DataDirectory.dir, "zotero-claude-assist");
}

/**
 * Working directory for single-shot `claude` calls. One fixed directory
 * (calls are serialized) because every distinct cwd makes Claude Code create
 * an entry under ~/.claude/projects/. See docs/decisions.md.
 */
export function oneShotRunDir(): string {
  return PathUtils.join(pluginDataDir(), "runs", "oneshot");
}
