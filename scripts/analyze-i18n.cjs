// i18n 覆盖分析 v3 —— 用与生成脚本一致的 key 提取，输出确定缺失的 UI 字符串
const fs = require("fs");
const path = require("path");

const root = "H:/AI/Clypra";
const provider = fs.readFileSync(path.join(root, "src/i18n/I18nProvider.tsx"), "utf8");

function extractKeys(block) {
  const keys = new Set();
  const re = /"((?:[^"\\]|\\.)*)"\s*:\s*"/g;
  let m;
  while ((m = re.exec(block))) keys.add(m[1]);
  return keys;
}
const zhTwBlock = provider.slice(provider.indexOf("const ZH_TW"), provider.indexOf("const ZH_CN"));
const zhCnBlock = provider.slice(provider.indexOf("const ZH_CN"), provider.indexOf("const EN_FROM_ZH_TW"));
const keySet = new Set([...extractKeys(zhTwBlock), ...extractKeys(zhCnBlock)]);
console.log("字典 key 总数:", keySet.size);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", "__tests__", "i18n", "workers"].includes(e.name)) continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(path.join(root, "src"));
const englishish = /^[A-Za-z][A-Za-z0-9 ,.'"!?%&/():;+*\-–—…~•◇●✂×|·<>$#@_]{2,}$/;
const tailwindish = /^(absolute|relative|fixed|sticky|static|flex|grid|block|inline|hidden|visible|opacity|animate|bg-|text-|border|rounded|shadow|ring|outline|w-|h-|min-w|max-w|min-h|max-h|p-\d|px-|py-|pt-|pr-|pb-|pl-|m-\d|mx-|my-|mt-|mr-|mb-|ml-|gap-|top-|left-|right-|bottom-|inset|object-|overflow|transition|pointer-events|select-none|cursor-|hover:|focus:|active:|group-|z-\d|space-|divide-|backdrop-|transform|origin-|scale-|rotate-|translate-|skew-|duration-|ease-|delay-|fill-|stroke-|blur-|brightness-|contrast-|grayscale-|invert-|saturate-|sepia-|hue-rotate-|drop-shadow-|font-|leading-|tracking-|italic|underline|line-through|uppercase|lowercase|capitalize|normal-|whitespace-|break-|truncate|list-|columns-|auto-|grid-cols|col-|row-|self-|justify-|items-|content-|place-|order-|flex-|basis-|grow|shrink|aspect-)/;

const candidates = new Map(); // str -> Set(locations)
const push = (s, loc) => {
  if (!candidates.has(s)) candidates.set(s, new Set());
  candidates.get(s).add(loc);
};

for (const f of files) {
  const content = fs.readFileSync(f, "utf8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 排除纯代码行（含运算符/引号较多的模板字符串）
    if (/[=<>{}()\[\]]/.test(line) && !/>\s*[^<>{}]*[A-Za-z]{2,}[^<>{}]*</.test(line)) {
      // 仍扫描 title/aria-label 属性
      const propRe = /\b(title|placeholder|aria-label)\s*=\s*["'`]([^"'`]{3,90})["'`]/g;
      let m;
      while ((m = propRe.exec(line))) {
        const s = m[2];
        if (englishish.test(s) && !tailwindish.test(s) && !keySet.has(s) && !/\$\{/.test(s)) push(`[attr:${m[1]}] ${s}`, `${f.replace(root, ".")}:${i + 1}`);
      }
      continue;
    }
    // JSX 文本节点
    const jsxRe = />\s*([^<>{}]*[A-Za-z][^<>{}]*?)\s*</g;
    let m;
    while ((m = jsxRe.exec(line))) {
      const t = m[1].trim();
      if (t.length < 3 || t.length > 90) continue;
      if (!englishish.test(t) || tailwindish.test(t) || keySet.has(t)) continue;
      if (/\$\{|=>|&&|\|\||\?\./.test(t)) continue;
      if (/^[a-z][a-z0-9-]*$/.test(t)) continue;
      if (/^(true|false|null|undefined|yes|no|ok|id|url|key|css|svg|png|jpg|jpeg|webp|mp4|mov|avi|mp3|wav|ogg|txt|json|xml|html|log|info|warn|error|debug|trace|none|auto|default)$/i.test(t)) continue;
      push(`[jsx] ${t}`, `${f.replace(root, ".")}:${i + 1}`);
    }
    // toast/notify
    const callRe = /\b(showToast|notify|enqueueToast|setStatus)\s*\(\s*["'`]([^"'`]{3,90})["'`]/g;
    while ((m = callRe.exec(line))) {
      const s = m[2];
      if (englishish.test(s) && !tailwindish.test(s) && !keySet.has(s) && !/\$\{/.test(s)) push(`[toast] ${s}`, `${f.replace(root, ".")}:${i + 1}`);
    }
  }
}

const results = [...candidates.entries()].sort((a, b) => a[0].localeCompare(b[0]));
console.log("\n=== 确定缺失的英文 UI 文案:", results.length, "条 ===");
for (const [k, locs] of results) {
  console.log(`${[...locs].join(" | ")}\t${k}`);
}
