// Pure: builds the Gemini user message for context translation (context.md §7,
// prompts/translate.md). Text is not escaped: the tags are plain delimiters and
// the prompt asks to keep math such as "a < b" exactly as written.

export interface TranslateInput {
  title: string;
  target: string;
  before: string;
  after: string;
}

export function buildTranslateMessage(i: TranslateInput): string {
  return [
    `<title>${i.title}</title>`,
    `<context_before>${i.before}</context_before>`,
    `<target>${i.target}</target>`,
    `<context_after>${i.after}</context_after>`,
  ].join("\n");
}

/** Session cache key: the same (target, context) gives the same result. */
export function translateCacheKey(i: TranslateInput): string {
  return JSON.stringify([i.target, i.before, i.after]);
}
