// Copies the canonical prompt files into addon/content/prompts/ so the build
// bundles them. Sources stay at prompts/ and vendor/ (see docs/decisions.md).
import { cpSync, mkdirSync, rmSync } from "node:fs";

const out = "addon/content/prompts";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/humanize-korean`, { recursive: true });
cpSync("prompts", out, { recursive: true });
for (const f of ["quick-rules.md", "discourse-patterns.md", "SOURCE.md"]) {
  cpSync(`vendor/humanize-korean/${f}`, `${out}/humanize-korean/${f}`);
}
// The build's asset glob (addon/**/*.*) skips files without an extension.
cpSync("vendor/humanize-korean/LICENSE", `${out}/humanize-korean/LICENSE.txt`);
