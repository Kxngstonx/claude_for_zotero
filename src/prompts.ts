// Prompt files (context.md §4): defaults are bundled under
// content/prompts/; at runtime the user-editable copy in prompts.dir wins.

import { getPref } from "./utils/prefs";
import { pluginDataDir } from "./paths";

export const PROMPT_FILES = [
  "context-note.md",
  "memo-batch.md",
  "sidebar-chat.md",
  "translate.md",
  "humanize-digest.md",
  "humanize-korean/quick-rules.md",
  "humanize-korean/discourse-patterns.md",
] as const;

export type PromptFile = (typeof PROMPT_FILES)[number];

/** prompts.dir if it is an absolute path, otherwise the default location. */
export function userPromptDir(): string {
  const configured = (getPref("prompts.dir") || "").trim();
  return configured.startsWith("/")
    ? configured
    : PathUtils.join(pluginDataDir(), "prompts");
}

function userPath(name: PromptFile): string {
  return PathUtils.join(userPromptDir(), ...name.split("/"));
}

function bundled(name: PromptFile): string {
  return Zotero.File.getContentsFromURL(
    `chrome://${addon.data.config.addonRef}/content/prompts/${name}`,
  );
}

/** Copies bundled defaults into the user directory; never overwrites. */
export async function ensureUserPrompts(): Promise<void> {
  for (const name of PROMPT_FILES) {
    const path = userPath(name);
    if (await IOUtils.exists(path)) continue;
    await IOUtils.makeDirectory(PathUtils.parent(path)!, {
      createAncestors: true,
    });
    await IOUtils.writeUTF8(path, bundled(name));
  }
}

export async function loadPrompt(name: PromptFile): Promise<string> {
  const path = userPath(name);
  if (await IOUtils.exists(path)) return IOUtils.readUTF8(path);
  return bundled(name);
}

/** Loads several prompt files and joins them with blank lines. */
export async function composePrompt(...names: PromptFile[]): Promise<string> {
  const parts = await Promise.all(names.map(loadPrompt));
  return parts.map((p) => p.trim()).join("\n\n");
}
