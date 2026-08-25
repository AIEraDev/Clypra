import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const roots = ["README.md", "CONTRIBUTING.md", "docs"];
const markdownFiles = [];

async function collect(entry) {
  const absolute = path.join(root, entry);
  const info = await stat(absolute);
  if (info.isFile()) {
    if (absolute.endsWith(".md")) markdownFiles.push(absolute);
    return;
  }
  for (const child of await readdir(absolute)) await collect(path.join(entry, child));
}

for (const entry of roots) await collect(entry);

const markdownLink = /\[[^\]]+\]\(([^)\s]+)(?:\s+[^)]*)?\)/g;
const failures = [];
for (const source of markdownFiles) {
  const content = await readFile(source, "utf8");
  for (const match of content.matchAll(markdownLink)) {
    const href = match[1].replace(/^<|>$/g, "");
    if (!href || href.startsWith("#") || /^[a-z][a-z+.-]*:/i.test(href)) continue;
    // Repository documentation also links directly to source files with an
    // optional `:line` suffix. That suffix is meaningful to the renderer but
    // is not part of the filesystem path being validated.
    const target = href.split("#", 1)[0].replace(/:\d+(?::\d+)?$/, "");
    if (!target) continue;
    const resolved = path.resolve(path.dirname(source), target);
    try {
      await stat(resolved);
    } catch {
      failures.push(`${path.relative(root, source)} -> ${href}`);
    }
  }
}

if (failures.length) {
  console.error("Broken local Markdown links:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Validated local Markdown links in ${markdownFiles.length} files.`);
