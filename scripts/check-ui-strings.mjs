import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const PASS_MESSAGE = "i18n check passed: no untranslated local UI strings";
const UI_NAMES = new Set([
  "title",
  "placeholder",
  "alt",
  "label",
  "description",
  "tooltip",
  "message",
  "aria-label",
  "aria-valuetext",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
]);
const UI_CALLS = new Set([
  "alert",
  "confirm",
  "showToast",
  "setToastMessage",
  "setError",
  "beginTransaction",
]);
const EXACT_TECHNICAL_VALUES = new Set([
  "Clypra",
  "H.264",
  "H.265",
  "HEVC",
  "ProRes",
  "CRF",
  "FPS",
  "GPU",
  "WebGL",
  "PixiJS",
  "FFmpeg",
  "Whisper",
  "WebM",
  "Inter",
  "Roboto",
  "Geist",
  "Montserrat",
  "Nunito",
  "Open Sans",
  "Oswald",
  "Outfit",
  "Playfair Display",
  "Raleway",
  "Dancing Script",
  "Roboto Condensed",
  "Space Grotesk",
  "Anton",
  "Bangers",
  "Bebas Neue",
  "Lato",
  "Pacifico",
  "Permanent Marker",
  "Poppins",
  "Press Start 2P",
  "Arial",
  "Arial Black",
  "Arial Rounded MT Bold",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Impact",
  "Verdana",
  "Trebuchet MS",
  "Palatino",
  "CLYPRA",
  "Rec.709",
  "V2",
  "URL:",
  "Esc",
  "Aa",
  "CC",
  "GitHub",
  "@AIEraDev",
  "Tauri 2.x",
  "React 19",
  "&times;",
  "aura",
  "sticker-",
  "filter-clip-",
]);

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function isExactTechnicalValue(text) {
  return (
    EXACT_TECHNICAL_VALUES.has(text) ||
    /^(?:https?|file|data):\/\/\S+$/i.test(text) ||
    /^data:[^\s,]+,[^\s]+$/i.test(text) ||
    /^(?:\.{0,2}\/|\/|[A-Za-z]:\\)\S+$/.test(text) ||
    /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(text) ||
    /^\.[A-Za-z0-9]+$/.test(text) ||
    /^\d{2,5}[x×]\d{2,5}$/i.test(text) ||
    /^\d{3,4}p$/i.test(text) ||
    /^\d+(?:\.\d+)?K$/.test(text) ||
    /^\d+(?:\.\d+)?x$/i.test(text) ||
    /^\d+(?:\.\d+)?\s?(?:px|%|ms|s|KB|MB|GB|Hz|kHz|dB|FPS)$/i.test(text) ||
    /^(?:px|ms|fps|fps \(|ms\/f\))$/i.test(text) ||
    /^[A-Za-z]$/.test(text) ||
    /^(?:⌘|⇧|⌥|⌃|Ctrl|Alt|Shift|Cmd)(?:\+?[A-Za-z0-9⌘⇧⌥⌃])+$/i.test(text)
  );
}

function isUntranslatedUiText(value) {
  const text = normalizeText(value);
  return (
    /[A-Za-z]/.test(text) &&
    !/[\u3400-\u9fff]/u.test(text) &&
    !isExactTechnicalValue(text)
  );
}

function propertyName(node) {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  return undefined;
}

function callName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)) {
    return expression.argumentExpression.text;
  }
  return undefined;
}

function callOwner(expression) {
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return propertyName(expression.expression);
  }
  return undefined;
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function scanSource(source, file = "src/Fixture.tsx") {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const constants = new Map();
  const shadowedTranslationBindings = [];
  const findings = new Map();

  function constantScope(node) {
    let current = node.parent;
    while (current) {
      if (
        ts.isSourceFile(current) ||
        ts.isBlock(current) ||
        ts.isModuleBlock(current) ||
        ts.isCaseBlock(current) ||
        ts.isForStatement(current) ||
        ts.isForInStatement(current) ||
        ts.isForOfStatement(current)
      ) {
        return current;
      }
      current = current.parent;
    }
    return sourceFile;
  }

  function resolveConstant(identifier) {
    const candidates = constants.get(identifier.text);
    if (!candidates) return undefined;
    return resolveScopedEntry(candidates, identifier);
  }

  function resolveScopedEntry(candidates, identifier) {
    const scopes = new Map();
    let current = identifier.parent;
    let distance = 0;
    while (current) {
      scopes.set(current, distance++);
      current = current.parent;
    }
    return candidates
      .filter(({ scope }) => scopes.has(scope))
      .sort((a, b) => scopes.get(a.scope) - scopes.get(b.scope))[0];
  }

  function addTranslationShadow(declaration, scope) {
    shadowedTranslationBindings.push({ declaration, scope });
  }

  function bindingContainsTranslationName(name) {
    if (ts.isIdentifier(name)) return name.text === "t";
    return name.elements.some(
      (element) => !ts.isOmittedExpression(element) && bindingContainsTranslationName(element.name),
    );
  }

  function visitConstants(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const importClause = node.importClause;
      const isI18nModule = node.moduleSpecifier.text === "@/i18n";
      if (importClause?.name?.text === "t") {
        addTranslationShadow(importClause.name, sourceFile);
      }
      const bindings = importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === "t") {
        addTranslationShadow(bindings, sourceFile);
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          if (element.name.text === "t" && (!isI18nModule || importedName !== "t")) {
            addTranslationShadow(element, sourceFile);
          }
        }
      }
    } else if (ts.isParameter(node) && bindingContainsTranslationName(node.name)) {
      addTranslationShadow(node, node.parent);
    } else if (ts.isFunctionDeclaration(node) && node.name?.text === "t") {
      addTranslationShadow(node, constantScope(node));
    } else if (ts.isFunctionExpression(node) && node.name?.text === "t") {
      addTranslationShadow(node, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      bindingContainsTranslationName(node.name)
    ) {
      addTranslationShadow(node, constantScope(node));
    } else if (
      ts.isCatchClause(node) &&
      node.variableDeclaration &&
      bindingContainsTranslationName(node.variableDeclaration.name)
    ) {
      addTranslationShadow(node.variableDeclaration, node);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      node.parent.flags & ts.NodeFlags.Const
    ) {
      const entries = constants.get(node.name.text) ?? [];
      entries.push({ declaration: node, initializer: node.initializer, scope: constantScope(node) });
      constants.set(node.name.text, entries);
    }
    ts.forEachChild(node, visitConstants);
  }

  function add(value, node) {
    const text = normalizeText(value);
    if (!isUntranslatedUiText(text)) return;
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    findings.set(`${line}\0${text}`, { file, line, text });
  }

  function collect(expression, seen = new Set()) {
    if (!expression) return;
    const node = unwrapExpression(expression);

    if (ts.isStringLiteralLike(node)) {
      add(node.text, node);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const staticText = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
        .join(" ");
      add(staticText, node);
      for (const span of node.templateSpans) collect(span.expression, seen);
      return;
    }
    if (ts.isTaggedTemplateExpression(node)) return;
    if (ts.isCallExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "t" &&
        !resolveScopedEntry(shadowedTranslationBindings, node.expression)
      ) {
        return;
      }
      for (const argument of node.arguments) collect(argument, seen);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      if (
        node.operatorToken.kind === ts.SyntaxKind.PlusToken ||
        node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        collect(node.left, seen);
        collect(node.right, seen);
      }
      return;
    }
    if (ts.isConditionalExpression(node)) {
      collect(node.whenTrue, seen);
      collect(node.whenFalse, seen);
      return;
    }
    if (ts.isIdentifier(node)) {
      const constant = resolveConstant(node);
      if (!constant || seen.has(constant.declaration.pos)) return;
      collect(constant.initializer, new Set([...seen, constant.declaration.pos]));
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      const target = unwrapExpression(node.expression);
      if (!ts.isIdentifier(target)) return;
      const constant = resolveConstant(target);
      if (!constant || seen.has(constant.declaration.pos)) return;
      const object = unwrapExpression(constant.initializer);
      if (!ts.isObjectLiteralExpression(object)) return;
      const member = object.properties.find(
        (property) => propertyName(property.name) === node.name.text,
      );
      if (member && ts.isPropertyAssignment(member)) {
        collect(member.initializer, new Set([...seen, constant.declaration.pos]));
      } else if (member && ts.isShorthandPropertyAssignment(member)) {
        collect(member.name, new Set([...seen, constant.declaration.pos]));
      }
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) collect(element, seen);
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const member of node.properties) {
        const name = propertyName(member.name);
        if (!name || !UI_NAMES.has(name)) continue;
        if (ts.isPropertyAssignment(member)) collect(member.initializer, seen);
        if (ts.isShorthandPropertyAssignment(member)) collect(member.name, seen);
      }
    }
  }

  function insideStyleElement(node) {
    let current = node.parent;
    while (current) {
      if (
        (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) &&
        propertyName(
          ts.isJsxElement(current)
            ? current.openingElement.tagName
            : current.tagName,
        ) === "style"
      ) {
        return true;
      }
      if (!ts.isJsxElement(current) && !ts.isJsxFragment(current)) break;
      current = current.parent;
    }
    return false;
  }

  function visit(node) {
    if (ts.isJsxText(node) && !insideStyleElement(node)) {
      add(node.text, node);
    } else if (ts.isJsxExpression(node) && node.expression && !insideStyleElement(node)) {
      const attribute = node.parent;
      if (ts.isJsxAttribute(attribute)) {
        if (UI_NAMES.has(attribute.name.text)) collect(node.expression);
      } else {
        collect(node.expression);
      }
    } else if (ts.isJsxAttribute(node) && UI_NAMES.has(node.name.text)) {
      if (node.initializer && ts.isStringLiteral(node.initializer)) add(node.initializer.text, node.initializer);
    } else if (ts.isPropertyAssignment(node) && UI_NAMES.has(propertyName(node.name))) {
      collect(node.initializer);
    } else if (ts.isShorthandPropertyAssignment(node) && UI_NAMES.has(node.name.text)) {
      collect(node.name);
    } else if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      if (name && (UI_CALLS.has(name) || callOwner(node.expression) === "toast")) {
        collect(node.arguments[0]);
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
      node.left.name.text === "label"
    ) {
      collect(node.right);
    }
    ts.forEachChild(node, visit);
  }

  visitConstants(sourceFile);
  visit(sourceFile);
  return [...findings.values()].sort(
    (a, b) =>
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line ||
      (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
  );
}

function shouldScanFile(file) {
  const normalized = file.replaceAll(path.sep, "/");
  return (
    /^src\/.*\.tsx?$/.test(normalized) &&
    !normalized.includes("/__tests__/") &&
    !/\.(?:test|spec)\.tsx?$/.test(normalized) &&
    !/(?:^|\/)[^/]*debug[^/]*(?:\/|$)/i.test(normalized) &&
    !normalized.endsWith(".d.ts") &&
    normalized !== "src/test-setup.ts"
  );
}

function resultFor(findings) {
  if (findings.length === 0) return { code: 0, output: PASS_MESSAGE };
  const sorted = [...findings].sort(
    (a, b) =>
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line ||
      (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
  );
  return {
    code: 1,
    output: sorted.map(({ file, line, text }) => `${file}:${line}: ${text}`).join("\n"),
  };
}

function sourceFiles(root = "src") {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (shouldScanFile(fullPath)) files.push(fullPath.replaceAll(path.sep, "/"));
    }
  }
  walk(root);
  return files.sort();
}

function runSelfTest({ announce = true } = {}) {
  const scan = (source, file = "src/Fixture.tsx") =>
    scanSource(source, file).map(({ line, text }) => `${file}:${line}: ${text}`);

  assert.deepEqual(scan(`const View = () => <div>Hello editor</div>;`), [
    "src/Fixture.tsx:1: Hello editor",
  ]);
  assert.deepEqual(
    scan(`const View = () => <button aria-label="Open project">Go now</button>;`),
    [
      "src/Fixture.tsx:1: Go now",
      "src/Fixture.tsx:1: Open project",
    ],
  );
  assert.deepEqual(
    scan(`const label = "Video preset"; const item = { label, description: "Best quality" };`),
    [
      "src/Fixture.tsx:1: Best quality",
      "src/Fixture.tsx:1: Video preset",
    ],
  );
  assert.deepEqual(
    scan(`toast.error("Export failed"); toast["warning"]("Upload failed"); setError("Try again"); showToast("Saved locally");`),
    [
      "src/Fixture.tsx:1: Export failed",
      "src/Fixture.tsx:1: Saved locally",
      "src/Fixture.tsx:1: Try again",
      "src/Fixture.tsx:1: Upload failed",
    ],
  );
  assert.deepEqual(
    scan(`this.label = "Move clip"; history.beginTransaction("Delete clips");`),
    [
      "src/Fixture.tsx:1: Delete clips",
      "src/Fixture.tsx:1: Move clip",
    ],
  );
  assert.deepEqual(
    scan(`setError(ok ? "Ready to export" : fallback || "Export unavailable");`),
    [
      "src/Fixture.tsx:1: Export unavailable",
      "src/Fixture.tsx:1: Ready to export",
    ],
  );
  assert.deepEqual(
    scan('setToastMessage(`Exported ${count} clips to ${folder}`);'),
    ["src/Fixture.tsx:1: Exported clips to"],
  );
  assert.deepEqual(scan(`alert(t("saved") + " Try again");`), [
    "src/Fixture.tsx:1: Try again",
  ]);
  assert.deepEqual(scan(`alert(identity("Open project"));`), [
    "src/Fixture.tsx:1: Open project",
  ]);
  assert.deepEqual(scan(`const t = (value: string) => value; alert(t("Open project"));`, "src/Fixture.ts"), [
    "src/Fixture.ts:1: Open project",
  ]);
  assert.deepEqual(scan(`let t = (value: string) => value; alert(t("Open project"));`, "src/Fixture.ts"), [
    "src/Fixture.ts:1: Open project",
  ]);
  assert.deepEqual(scan(`function t(value: string) { return value; } alert(t("Open project"));`, "src/Fixture.ts"), [
    "src/Fixture.ts:1: Open project",
  ]);
  assert.deepEqual(scan(`function view(t: (value: string) => string) { alert(t("Open project")); }`, "src/Fixture.ts"), [
    "src/Fixture.ts:1: Open project",
  ]);
  assert.deepEqual(scan(`function view({ t }: { t: (value: string) => string }) { alert(t("Open project")); }`, "src/Fixture.ts"), [
    "src/Fixture.ts:1: Open project",
  ]);
  assert.deepEqual(scan(`const { t } = helpers; alert(t("Open project"));`, "src/Fixture.ts"), [
    "src/Fixture.ts:1: Open project",
  ]);
  assert.deepEqual(scan(`import { translate as t } from "other"; alert(t("Open project"));`, "src/Fixture.ts"), [
    "src/Fixture.ts:1: Open project",
  ]);
  assert.deepEqual(scan(`import { t } from "@/i18n"; alert(t("message.key"));`, "src/Fixture.ts"), []);
  assert.deepEqual(
    scan(`const retry = "Try again"; const message = retry; const copy = { message }; alert(copy.message);`),
    ["src/Fixture.tsx:1: Try again"],
  );
  assert.deepEqual(
    scan(`const copy = (("Open project" as string)!) satisfies string; alert(copy);`, "src/Fixture.ts"),
    ["src/Fixture.ts:1: Open project"],
  );
  assert.deepEqual(
    scan(`const title = "Export video"; const meta = { title }; <Card {...meta} />;`),
    ["src/Fixture.tsx:1: Export video"],
  );
  assert.deepEqual(
    scan(`const title = "Open project"; const First = () => <button title={title} />; { const title = t("safe"); const Second = () => <button title={title} />; }`),
    ["src/Fixture.tsx:1: Open project"],
  );
  assert.deepEqual(
    scan(`const View = () => <div>{t("ready")}{remoteName}{asset.description}</div>;`),
    [],
  );
  assert.deepEqual(
    scan(`const View = () => <div title="导出视频">已保存</div>;`),
    [],
  );
  assert.deepEqual(
    scan(`const View = () => <video aria-controls="preview" aria-labelledby="preview-title" />;`),
    [],
  );
  assert.deepEqual(
    scan(`const View = () => <div style={{ fontFamily: "Inter", display: "block" }}><style>{".x { color: red; }"}</style></div>;`),
    [],
  );
  assert.deepEqual(
    scan(`const values = ["Clypra", "CLYPRA", "H.264", "HEVC", "ProRes", "CRF", "60 FPS", "GPU", "WebGL", "PixiJS", "FFmpeg", "Whisper", "WebM", "Rec.709", "V2", "720p", "4K", "0.5x", "px", "ms", "fps (", "ms/f)", "Inter", "Arial", "Times New Roman", "GitHub", "@AIEraDev", "Tauri 2.x", "React 19", "URL:", "Esc", "Aa", "CC", "&times;", "x", "aura", "sticker-", "filter-clip-", "https://example.com/a", "data:image/png;base64,AAAA", "video/mp4", ".mp4", "1920x1080", "12 MB", "⌘K"]; const View = () => <>{values}</>;`),
    [],
  );
  assert.deepEqual(scan(`alert("FFmpeg export failed");`), [
    "src/Fixture.tsx:1: FFmpeg export failed",
  ]);
  assert.equal(shouldScanFile("src/App.tsx"), true);
  for (const file of [
    "src/__tests__/App.tsx",
    "src/App.test.tsx",
    "src/App.spec.ts",
    "src/components/debug/Overlay.tsx",
    "src/debug.tsx",
    "src/components/DebugOverlay.tsx",
    "src/types.d.ts",
    "src/test-setup.ts",
    "scripts/check.ts",
  ]) {
    assert.equal(shouldScanFile(file), false, file);
  }

  const duplicate = scanSource(
    `const message = "Save project"; alert(message); alert(message);\nalert("Cancel export");`,
    "src/Z.tsx",
  );
  assert.deepEqual(duplicate, [
    { file: "src/Z.tsx", line: 1, text: "Save project" },
    { file: "src/Z.tsx", line: 2, text: "Cancel export" },
  ]);
  assert.deepEqual(resultFor([]), { code: 0, output: PASS_MESSAGE });
  assert.deepEqual(resultFor(duplicate), {
    code: 1,
    output: "src/Z.tsx:1: Save project\nsrc/Z.tsx:2: Cancel export",
  });
  assert.equal(
    resultFor([
      { file: "src/Z.tsx", line: 2, text: "Later" },
      { file: "src/A.tsx", line: 3, text: "Earlier" },
    ]).output,
    "src/A.tsx:3: Earlier\nsrc/Z.tsx:2: Later",
  );

  if (announce) console.log("i18n self-test passed");
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  runSelfTest({ announce: false });
  const findings = sourceFiles().flatMap((file) =>
    scanSource(fs.readFileSync(file, "utf8"), file),
  );
  const result = resultFor(findings);
  console.log(result.output);
  process.exitCode = result.code;
}
