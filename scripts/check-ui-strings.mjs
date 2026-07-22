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
  "toast",
  "setToastMessage",
  "setError",
  "beginTransaction",
  "fillText",
]);
const TECHNICAL_TEXT_ELEMENTS = new Set(["style", "code", "pre"]);
const SHORTCUT_KEY = String.raw`(?:[A-Za-z0-9]|F(?:[1-9]|1\d|2[0-4])|Enter|Esc|Escape|Space|Tab|Backspace|Delete|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right))`;
const STANDALONE_SHORTCUT_KEY = String.raw`(?:F(?:[1-9]|1\d|2[0-4])|Enter|Esc|Escape|Space|Tab|Backspace|Delete|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right))`;
const SHORTCUT_VALUE = new RegExp(
  `^(?:${STANDALONE_SHORTCUT_KEY}|[⌘⇧⌥⌃]+\\+?${SHORTCUT_KEY}|(?:(?:Ctrl|Alt|Shift|Cmd)\\+)+${SHORTCUT_KEY})$`,
  "i",
);
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
    /^(?:application|audio|font|image|message|model|multipart|text|video)\/[a-z0-9][a-z0-9.+-]*$/i.test(text) ||
    /^\.[A-Za-z0-9]+$/.test(text) ||
    /^\d{2,5}[x×]\d{2,5}$/i.test(text) ||
    /^\d{3,4}p$/i.test(text) ||
    /^\d+(?:\.\d+)?K$/.test(text) ||
    /^\d+(?:\.\d+)?x$/i.test(text) ||
    /^\d+(?:\.\d+)?\s?(?:px|%|ms|s|KB|MB|GB|Hz|kHz|dB|FPS)$/i.test(text) ||
    /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\([^()\n]*\)$/.test(text) ||
    /^(?:px|ms|fps)$/i.test(text) ||
    /^[A-Za-z]$/.test(text) ||
    SHORTCUT_VALUE.test(text)
  );
}

function isAllowedAsciiSpan(value) {
  const text = normalizeText(value);
  if (!/[A-Za-z]/.test(text) || isExactTechnicalValue(text)) return true;
  if (
    ((text.startsWith("(") && text.endsWith(")")) ||
      (text.startsWith("[") && text.endsWith("]")) ||
      (text.startsWith("{") && text.endsWith("}"))) &&
    isExactTechnicalValue(text.slice(1, -1).trim())
  ) {
    return true;
  }
  return false;
}

function isUntranslatedUiText(value) {
  const text = normalizeText(value);
  if (!/[A-Za-z]/.test(text)) return false;
  if (!/[\u3400-\u9fff]/u.test(text)) return !isExactTechnicalValue(text);
  return (text.match(/[\x20-\x7e⌘⇧⌥⌃]+/g) ?? []).some((span) => !isAllowedAsciiSpan(span));
}

function propertyName(node) {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  if (ts.isComputedPropertyName(node)) {
    const expression = unwrapExpression(node.expression);
    if (ts.isStringLiteralLike(expression)) return expression.text;
  }
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
  const translationImports = [];
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
          if (element.name.text === "t") {
            if (isI18nModule && importedName === "t") {
              translationImports.push({ declaration: element, scope: sourceFile });
            } else {
              addTranslationShadow(element, sourceFile);
            }
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

  function isTranslationCall(node) {
    return (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "t" &&
      resolveScopedEntry(translationImports, node.expression) &&
      !resolveScopedEntry(shadowedTranslationBindings, node.expression)
    );
  }

  function isNonUiStringPredicateCall(node) {
    return (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "startsWith"
    );
  }

  function resolveStaticExpression(expression, seen) {
    const node = unwrapExpression(expression);
    if (ts.isIdentifier(node)) {
      const constant = resolveConstant(node);
      if (!constant || seen.has(constant.declaration.pos)) return undefined;
      return {
        expression: constant.initializer,
        seen: new Set([...seen, constant.declaration.pos]),
      };
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)
          ? node.argumentExpression.text
          : undefined;
      if (!name) return undefined;
      const target = resolveStaticExpression(node.expression, seen);
      if (!target) return undefined;
      const object = unwrapExpression(target.expression);
      if (!ts.isObjectLiteralExpression(object)) return undefined;
      const member = object.properties.find((property) => propertyName(property.name) === name);
      if (member && ts.isPropertyAssignment(member)) {
        return (
          resolveStaticExpression(member.initializer, target.seen) ??
          { expression: member.initializer, seen: target.seen }
        );
      }
      if (member && ts.isShorthandPropertyAssignment(member)) {
        return resolveStaticExpression(member.name, target.seen);
      }
    }
    return undefined;
  }

  function collect(
    expression,
    seen = new Set(),
    collectAllObjectValues = false,
    followCallArguments = false,
  ) {
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
      for (const span of node.templateSpans) {
        collect(span.expression, seen, collectAllObjectValues, followCallArguments);
      }
      return;
    }
    if (ts.isTaggedTemplateExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.tag) &&
        ts.isIdentifier(node.tag.expression) &&
        node.tag.expression.text === "String" &&
        node.tag.name.text === "raw"
      ) {
        collect(node.template, seen, collectAllObjectValues, followCallArguments);
      }
      return;
    }
    if (ts.isCallExpression(node)) {
      if (isTranslationCall(node)) {
        for (const argument of node.arguments.slice(1)) collect(argument, seen, true, false);
        return;
      }
      if (
        collectAllObjectValues ||
        !followCallArguments ||
        isNonUiStringPredicateCall(node)
      ) {
        return;
      }
      for (const argument of node.arguments) {
        collect(argument, seen, collectAllObjectValues, followCallArguments);
      }
      return;
    }
    if (ts.isBinaryExpression(node)) {
      if (
        node.operatorToken.kind === ts.SyntaxKind.PlusToken ||
        node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        collect(node.left, seen, collectAllObjectValues, followCallArguments);
        collect(node.right, seen, collectAllObjectValues, followCallArguments);
      }
      return;
    }
    if (ts.isConditionalExpression(node)) {
      collect(node.whenTrue, seen, collectAllObjectValues, followCallArguments);
      collect(node.whenFalse, seen, collectAllObjectValues, followCallArguments);
      return;
    }
    if (ts.isIdentifier(node)) {
      const constant = resolveConstant(node);
      if (!constant || seen.has(constant.declaration.pos)) return;
      collect(
        constant.initializer,
        new Set([...seen, constant.declaration.pos]),
        collectAllObjectValues,
        followCallArguments,
      );
      return;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const resolved = resolveStaticExpression(node, seen);
      if (resolved) {
        collect(resolved.expression, resolved.seen, collectAllObjectValues, followCallArguments);
      }
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) {
        collect(element, seen, collectAllObjectValues, followCallArguments);
      }
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const member of node.properties) {
        const name = propertyName(member.name);
        if (!collectAllObjectValues && (!name || !UI_NAMES.has(name))) continue;
        if (ts.isPropertyAssignment(member)) {
          collect(member.initializer, seen, collectAllObjectValues, followCallArguments);
        }
        if (ts.isShorthandPropertyAssignment(member)) {
          collect(member.name, seen, collectAllObjectValues, followCallArguments);
        }
        if (collectAllObjectValues && ts.isSpreadAssignment(member)) {
          collect(member.expression, seen, true, false);
        }
      }
    }
  }

  function insideTechnicalTextElement(node) {
    let current = node.parent;
    while (current) {
      if (
        (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) &&
        TECHNICAL_TEXT_ELEMENTS.has(propertyName(
          ts.isJsxElement(current)
            ? current.openingElement.tagName
            : current.tagName,
        ))
      ) {
        return true;
      }
      if (!ts.isJsxElement(current) && !ts.isJsxFragment(current)) break;
      current = current.parent;
    }
    return false;
  }

  function visit(node) {
    if (
      ts.isJsxElement(node) &&
      TECHNICAL_TEXT_ELEMENTS.has(propertyName(node.openingElement.tagName))
    ) {
      visit(node.openingElement);
      return;
    }
    if (ts.isJsxText(node) && !insideTechnicalTextElement(node)) {
      add(node.text, node);
    } else if (ts.isJsxExpression(node) && node.expression && !insideTechnicalTextElement(node)) {
      const attribute = node.parent;
      if (ts.isJsxAttribute(attribute)) {
        if (UI_NAMES.has(attribute.name.text)) collect(node.expression, new Set(), false, true);
      } else {
        collect(node.expression, new Set(), false, true);
      }
    } else if (ts.isJsxAttribute(node) && UI_NAMES.has(node.name.text)) {
      if (node.initializer && ts.isStringLiteral(node.initializer)) add(node.initializer.text, node.initializer);
    } else if (ts.isPropertyAssignment(node) && UI_NAMES.has(propertyName(node.name))) {
      collect(node.initializer, new Set(), false, true);
    } else if (ts.isShorthandPropertyAssignment(node) && UI_NAMES.has(node.name.text)) {
      collect(node.name, new Set(), false, true);
    } else if (ts.isCallExpression(node)) {
      if (isTranslationCall(node)) {
        for (const argument of node.arguments.slice(1)) collect(argument, new Set(), true, false);
      } else {
        const name = callName(node.expression);
        if (name && (UI_CALLS.has(name) || callOwner(node.expression) === "toast")) {
          collect(node.arguments[0], new Set(), false, true);
        }
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
      node.left.name.text === "label"
    ) {
      collect(node.right, new Set(), false, true);
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
    !/(?:^|\/)(?:tests|spec)(?:\/|$)/.test(normalized) &&
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
  assert.deepEqual(scan(`import { t } from "@/i18n"; alert(t("saved") + " Try again");`), [
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
  assert.deepEqual(scan(`alert(t("Open project"));`, "src/Fixture.ts"), [
    "src/Fixture.ts:1: Open project",
  ]);
  assert.deepEqual(scan(`const { t } = require("@/i18n"); alert(t("Open project"));`, "src/Fixture.ts"), [
    "src/Fixture.ts:1: Open project",
  ]);
  assert.deepEqual(
    scan(`import { t } from "@/i18n"; { const t = (value: string) => value; alert(t("Open project")); }`, "src/Fixture.ts"),
    ["src/Fixture.ts:1: Open project"],
  );
  assert.deepEqual(
    scan(`import { t } from "@/i18n"; alert(t("message.key", { name: "Open project", value: remoteName, detail: remoteCopy.name }));`, "src/Fixture.ts"),
    ["src/Fixture.ts:1: Open project"],
  );
  assert.deepEqual(
    scan(`import { t } from "@/i18n"; const name = "Open project"; alert(t("message.key", { name }));`, "src/Fixture.ts"),
    ["src/Fixture.ts:1: Open project"],
  );
  assert.deepEqual(
    scan(`import { t } from "@/i18n"; const copy = { name: "Open project" }; alert(t("message.key", { name: copy.name }));`, "src/Fixture.ts"),
    ["src/Fixture.ts:1: Open project"],
  );
  assert.deepEqual(
    scan(`import { t } from "@/i18n"; const model = remoteModel || DEFAULT_MODEL; alert(t("message.key", { model }));`, "src/Fixture.ts"),
    [],
  );
  assert.deepEqual(
    scan(`import { t } from "@/i18n"; t("message.key", { command: 'localStorage.setItem("flag", "1")' });`, "src/Fixture.ts"),
    [],
  );
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
    scan(`import { t } from "@/i18n"; const title = "Open project"; const First = () => <button title={title} />; { const title = t("safe"); const Second = () => <button title={title} />; }`),
    ["src/Fixture.tsx:1: Open project"],
  );
  assert.deepEqual(
    scan(`import { t } from "@/i18n"; const View = () => <div>{t("ready")}{remoteName}{asset.description}</div>;`),
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
    scan(`const values = ["Clypra", "CLYPRA", "H.264", "HEVC", "ProRes", "CRF", "60 FPS", "GPU", "WebGL", "PixiJS", "FFmpeg", "Whisper", "WebM", "Rec.709", "V2", "720p", "4K", "0.5x", "px", "ms", "Inter", "Arial", "Times New Roman", "GitHub", "@AIEraDev", "Tauri 2.x", "React 19", "URL:", "Esc", "Aa", "CC", "&times;", "x", "https://example.com/a", "data:image/png;base64,AAAA", "video/mp4", ".mp4", "1920x1080", "12 MB", "⌘K"]; const View = () => <>{values}</>;`),
    [],
  );
  assert.deepEqual(
    scan(`const View = () => <><span>导出 Export video</span><span>立即 Save now</span><span>使用 FFmpeg 导出</span></>;`),
    [
      "src/Fixture.tsx:1: 导出 Export video",
      "src/Fixture.tsx:1: 立即 Save now",
    ],
  );
  assert.deepEqual(scan(`const View = () => <button title="Alternative">Alt+K</button>;`), [
    "src/Fixture.tsx:1: Alternative",
  ]);
  assert.deepEqual(scan(`const View = () => <div>{formatLabel("Open project")}</div>;`), [
    "src/Fixture.tsx:1: Open project",
  ]);
  assert.deepEqual(
    scan(`const getCategoryIcon = (value: string) => value; const View = () => <div>{getCategoryIcon("Open project")}</div>;`),
    ["src/Fixture.tsx:1: Open project"],
  );
  assert.deepEqual(
    scan(`const startsWith = (value: string) => value; const View = () => <div>{startsWith("Open project")}</div>;`),
    ["src/Fixture.tsx:1: Open project"],
  );
  assert.deepEqual(scan(`const View = () => <div>请选择 Open/Save 操作</div>;`), [
    "src/Fixture.tsx:1: 请选择 Open/Save 操作",
  ]);
  assert.deepEqual(
    scan(`const View = () => <><code>npm run build</code><pre>git diff --check</pre></>;`),
    [],
  );
  assert.deepEqual(
    scan(`const View = () => <pre>{JSON.stringify({ label: "Open project" })}</pre>;`),
    [],
  );
  assert.deepEqual(scan(`const View = () => <><span>详情 (F12)</span><span>提交 (⌘Enter)</span></>;`), []);
  assert.deepEqual(scan(`alert(String.raw\`Open project\`);`), [
    "src/Fixture.tsx:1: Open project",
  ]);
  assert.deepEqual(scan(`toast("Saved locally");`), [
    "src/Fixture.tsx:1: Saved locally",
  ]);
  assert.deepEqual(
    scan(`const copy = { nested: { text: "Open project" }, text: "Save now" }; alert(copy.nested.text); alert(copy["text"]);`),
    [
      "src/Fixture.tsx:1: Open project",
      "src/Fixture.tsx:1: Save now",
    ],
  );
  assert.deepEqual(
    scan(`const inner = { text: "Open project" }; const copy = { nested: inner }; alert(copy.nested.text);`),
    ["src/Fixture.tsx:1: Open project"],
  );
  assert.deepEqual(scan(`const props = { ["aria-label"]: "Open project" };`), [
    "src/Fixture.tsx:1: Open project",
  ]);
  assert.deepEqual(scan(`const View = () => <>{["aura", "sticker-", "filter-clip-"]}</>;`), [
    "src/Fixture.tsx:1: aura",
    "src/Fixture.tsx:1: filter-clip-",
    "src/Fixture.tsx:1: sticker-",
  ]);
  assert.deepEqual(scan(`const View = () => <span>{fps} fps ({ms}ms/f)</span>;`), [
    "src/Fixture.tsx:1: fps (",
    "src/Fixture.tsx:1: ms/f)",
  ]);
  assert.deepEqual(scan(`ctx.fillText("Render Error", 0, 0);`), [
    "src/Fixture.tsx:1: Render Error",
  ]);
  assert.deepEqual(
    scan(`const isSticker = id.startsWith("sticker-"); const icon = icons[category || "aura"]; const View = () => <>{isSticker}{icon}</>;`),
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
    "src/components/tests/App.tsx",
    "src/components/spec/App.tsx",
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
