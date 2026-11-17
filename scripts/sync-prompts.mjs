// Copies the canonical prompt files into addon/content/prompts/ so the build
// bundles them. Sources stay at prompts/ and vendor/ (see docs/decisions.md).
//
// Also writes known-defaults.json: for each prompt, the md5 of every version
// committed to git plus the working-tree version. At startup the plugin
// replaces a user's copy only if its md5 is in this list, i.e. the user never
// edited it (src/prompts.ts).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

const out = "addon/content/prompts";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/humanize-korean`, { recursive: true });
cpSync("prompts", out, { recursive: true });
for (const f of ["quick-rules.md", "discourse-patterns.md", "SOURCE.md"]) {
  cpSync(`vendor/humanize-korean/${f}`, `${out}/humanize-korean/${f}`);
}
// The build's asset glob (addon/**/*.*) skips files without an extension.
cpSync("vendor/humanize-korean/LICENSE", `${out}/humanize-korean/LICENSE.txt`);

// Prompt name (as used in src/prompts.ts) → source path in this repo.
const SOURCES = {
  "context-note.md": "prompts/context-note.md",
  "memo-batch.md": "prompts/memo-batch.md",
  "sidebar-chat.md": "prompts/sidebar-chat.md",
  "translate.md": "prompts/translate.md",
  "humanize-digest.md": "prompts/humanize-digest.md",
  "humanize-korean/quick-rules.md": "vendor/humanize-korean/quick-rules.md",
  "humanize-korean/discourse-patterns.md":
    "vendor/humanize-korean/discourse-patterns.md",
};

const md5 = (buf) => createHash("md5").update(buf).digest("hex");
const git = (...args) =>
  execFileSync("git", args, {
    maxBuffer: 64 << 20,
    stdio: ["ignore", "pipe", "ignore"],
  });

const known = {};
for (const [name, src] of Object.entries(SOURCES)) {
  const hashes = new Set([md5(readFileSync(src))]);
  try {
    const commits = git("log", "--format=%H", "--", src)
      .toString()
      .split("\n")
      .filter(Boolean);
    for (const c of commits) {
      try {
        hashes.add(md5(git("show", `${c}:${src}`)));
      } catch {
        // file deleted in that commit
      }
    }
  } catch {
    // not a git checkout: only the current version is known
  }
  known[name] = [...hashes];
}
writeFileSync(
  `${out}/known-defaults.json`,
  JSON.stringify(known, null, 2) + "\n",
);
