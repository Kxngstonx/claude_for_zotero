// Memo question syntax in annotation comments (context.md §9.1). Pure.
//
// A line whose head is "@claude" + whitespace, and whose next character is
// not "✓", is one pending question. Answered lines become "@claude ✓ …".
// Comments are plain text (literal <b>/<i>/<sub>/<sup> tags may appear);
// only the marked line is changed, everything else is kept byte for byte.

export interface MemoLine {
  /** 1-based line number within the comment. */
  line: number;
  question: string;
}

// "\r" is excluded and allowed before the end so CRLF comments work and keep
// their line endings.
const PENDING = /^([ \t]*@claude)[ \t]+(?!✓)(\S[^\r]*)\r?$/;

export function pendingQuestions(
  comment: string | null | undefined,
): MemoLine[] {
  if (!comment) return [];
  const out: MemoLine[] = [];
  comment.split("\n").forEach((l, i) => {
    const m = l.match(PENDING);
    if (m) out.push({ line: i + 1, question: m[2].trim() });
  });
  return out;
}

/**
 * Marks the question as answered. Looks at `line` first; if the comment was
 * edited meanwhile, falls back to the first pending line with the same
 * question text. Returns null if the question is no longer pending.
 */
export function markAnswered(
  comment: string,
  line: number,
  question: string,
): string | null {
  const lines = comment.split("\n");
  const isIt = (l: string | undefined) => {
    const m = l?.match(PENDING);
    return !!m && m[2].trim() === question;
  };
  const idx = isIt(lines[line - 1]) ? line - 1 : lines.findIndex(isIt);
  if (idx < 0) return null;
  lines[idx] = lines[idx].replace(/^([ \t]*@claude)[ \t]+/, "$1 ✓ ");
  return lines.join("\n");
}
