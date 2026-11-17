// Pure: what to do with a user's prompt copy at startup. No Zotero globals.

export type PromptAction = "create" | "update" | "keep";

/**
 * create: no user copy yet.
 * update: the copy is an unedited older default (its md5 is a known default)
 *         and differs from the bundled one.
 * keep:   already current, or edited by the user.
 */
export function promptAction(
  userMd5: string | null,
  bundledMd5: string,
  knownDefaults: string[],
): PromptAction {
  if (userMd5 === null) return "create";
  if (userMd5 === bundledMd5) return "keep";
  return knownDefaults.includes(userMd5) ? "update" : "keep";
}
