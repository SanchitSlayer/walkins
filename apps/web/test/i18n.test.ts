import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { MESSAGES } from "@walkins/shared";

// Every user-facing string goes through the message catalog
// (packages/shared/src/messages/en.json), so that Hindi later is translation
// rather than archaeology. This test is what keeps it that way: it fails on
// a hardcoded string, on a key the catalog doesn't have, and on a catalog
// key nothing uses.
//
// The web app is checked thoroughly: any text a page renders. The API and
// worker are checked at the places they speak to a person directly (see
// serverPhrases); words they store to show later are not something syntax
// can tell from internal text, and the README lists those.
//
// Escape hatches, both deliberate and visible in review:
// - data-i18n-ignore on a JSX element exempts its subtree (content that is
//   data, such as a sample on the design specimen).
// - an "i18n-ignore" comment on the same line exempts that line, and must say
//   why.

const WEB = join(__dirname, "..");
const SCANNED = ["app", "components", "lib"];
// The design specimen is sample content for the design system, not product.
const EXEMPT = ["app/design"];
const USER_ATTRIBUTES = new Set(["placeholder", "aria-label", "title", "alt", "label", "hint", "legend", "summary", "aria-description"]);
// The only words allowed raw: the product's name.
const ALLOWED = new Set(["Walkins"]);
// Callers whose string arguments a person reads.
const USER_CALLS = new Set(["setError", "setNotice", "confirm", "alert", "prompt"]);
// Formatting must follow the page's locale; these bypass it.
const BARE_FORMATTERS = new Set(["formatTime", "dayLabel", "formatWhen", "formatSalary", "formatPaise", "formatExperience", "formatDistance", "formatSeats"]);
// Namespaces the API and worker use; the web app need not reference them.
const SERVER_NAMESPACES = new Set(["alerts", "bot", "errors", "fields", "format"]);
const SERVER_SOURCES = ["../api/src", "../worker/src"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

const sources = SCANNED.flatMap((dir) => files(join(WEB, dir)))
  .filter((path) => !EXEMPT.some((exempt) => relative(WEB, path).startsWith(exempt)))
  .map((path) => ({
    path: relative(WEB, path),
    file: ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS),
  }));

// Words a person reads, as opposed to keys: a catalog key ("errors.generic")
// or a camelCase key relative to a namespace ("adminDesk").
const prose = (text: string) =>
  /\p{L}{2,}/u.test(text) && !ALLOWED.has(text.trim()) && !/^[a-z]+[A-Z][A-Za-z]*$/.test(text) && typeof resolve(text) !== "string";

function ignoredLine(file: ts.SourceFile, node: ts.Node) {
  const { line } = file.getLineAndCharacterOfPosition(node.getStart());
  return file.text.split("\n")[line].includes("i18n-ignore");
}

function insideIgnored(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    const opening = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
    if (opening?.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText() === "data-i18n-ignore")) return true;
  }
  return false;
}

// Is this string expression something a person will read? Walks up through
// ternaries, ||, ??, template spans and parentheses to what consumes it.
function userFacing(node: ts.Node, text: string): boolean {
  let n = node;
  while (
    n.parent &&
    (ts.isConditionalExpression(n.parent) ||
      ts.isParenthesizedExpression(n.parent) ||
      ts.isTemplateSpan(n.parent) ||
      ts.isTemplateExpression(n.parent) ||
      (ts.isBinaryExpression(n.parent) &&
        [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.PlusToken].includes(
          n.parent.operatorToken.kind,
        )))
  ) {
    if (ts.isConditionalExpression(n.parent) && n.parent.condition === n) return false;
    n = n.parent;
  }
  const parent = n.parent;
  if (!parent) return false;
  if (ts.isJsxExpression(parent)) {
    const holder = parent.parent;
    if (ts.isJsxAttribute(holder)) return USER_ATTRIBUTES.has(holder.name.getText());
    return true;
  }
  if (ts.isJsxAttribute(parent)) return USER_ATTRIBUTES.has(parent.name.getText());
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    const callee = parent.expression.getText();
    return USER_CALLS.has(callee) || callee === "ApiError" || callee.endsWith(".push") === false && /^(set[A-Z]\w*Error|setNotice)$/.test(callee);
  }
  // Labels and sentences kept in lookup tables: { CONFIRMED: "Booked" }.
  // Identifiers ("dot") and class lists ("text-ink border-ink-muted") in
  // the same kind of table don't count.
  if (ts.isPropertyAssignment(parent) && parent.initializer === n) return readsAsText(text);
  return false;
}

// Two or more plain words make a phrase; class lists and CSS values
// ("text-ink border-ink-muted", "1px solid var(--x)") are mostly not words.
function readsAsText(text: string): boolean {
  if (/^\p{Lu}\p{Ll}/u.test(text)) return true;
  const tokens = text.split(/\s+/).filter(Boolean);
  const words = tokens.filter((w) => /^\p{L}+[,.;:!?]?$/u.test(w));
  return words.length >= 2 && words.length * 2 > tokens.length;
}

function hardcoded(): string[] {
  const found: string[] = [];
  for (const { path, file } of sources) {
    const report = (node: ts.Node, text: string) => {
      if (insideIgnored(node) || ignoredLine(file, node)) return;
      const { line } = file.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${path}:${line + 1}  ${JSON.stringify(text.trim().slice(0, 70))}`);
    };
    (function visit(node: ts.Node) {
      if (ts.isJsxText(node) && prose(node.text)) report(node, node.text);
      else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && prose(node.text) && userFacing(node, node.text)) report(node, node.text);
      else if (ts.isTemplateExpression(node)) {
        const text = node.head.text + node.templateSpans.map((s) => s.literal.text).join(" ");
        if (prose(text) && userFacing(node, text)) report(node, text);
      }
      ts.forEachChild(node, visit);
    })(file);
  }
  return found;
}

function bareFormatterImports(): string[] {
  const found: string[] = [];
  for (const { path, file } of sources) {
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || (statement.moduleSpecifier as ts.StringLiteral).text !== "@walkins/shared") continue;
      const names = statement.importClause?.namedBindings;
      if (names && ts.isNamedImports(names)) {
        for (const element of names.elements) if (BARE_FORMATTERS.has(element.name.text)) found.push(`${path}: ${element.name.text}`);
      }
    }
  }
  return found;
}

type Lookup = Record<string, unknown>;
const catalog = MESSAGES.en as unknown as Lookup;

function leaves(node: Lookup, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : leaves(value as Lookup, `${prefix}${key}.`),
  );
}

function resolve(key: string): unknown {
  return key.split(".").reduce<unknown>((n, part) => (n as Lookup | undefined)?.[part], catalog);
}

// Keys the code uses: t("x") where t came from useTranslations("ns") or
// getTranslations("ns"). A key built at runtime counts as using everything
// under its static prefix, which must itself exist.
function usedKeys(): { exact: Set<string>; prefixes: Set<string>; missing: string[] } {
  const exact = new Set<string>();
  const prefixes = new Set<string>();
  const missing: string[] = [];
  for (const { path, file } of sources) {
    const namespaces = new Map<string, string>();
    (function visit(node: ts.Node) {
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
        let init: ts.Expression = node.initializer;
        if (ts.isAwaitExpression(init)) init = init.expression;
        if (ts.isCallExpression(init) && /^(useTranslations|getTranslations)$/.test(init.expression.getText())) {
          const arg = init.arguments[0];
          namespaces.set(node.name.text, arg && ts.isStringLiteral(arg) ? `${arg.text}.` : "");
        }
      }
      // A key passed along as a value (an error fallback, a lookup table of
      // keys) counts as used wherever it appears in full.
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && typeof resolve(node.text) === "string") exact.add(node.text);
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression.text : null;
        const ns = name !== null ? namespaces.get(name) : undefined;
        const arg = node.arguments[0];
        if (ns !== undefined && arg) {
          const { line } = file.getLineAndCharacterOfPosition(node.getStart());
          if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
            const key = ns + arg.text;
            exact.add(key);
            if (typeof resolve(key) !== "string" && !(ts.isPropertyAccessExpression(callee) && callee.name.text === "has")) {
              missing.push(`${path}:${line + 1} ${key}`);
            }
          } else if (ts.isTemplateExpression(arg)) {
            const prefix = (ns + arg.head.text).replace(/\.$/, "");
            prefixes.add(prefix);
            if (typeof resolve(prefix) !== "object") missing.push(`${path}:${line + 1} ${prefix}.*`);
          } else {
            prefixes.add(ns.replace(/\.$/, ""));
          }
        }
      }
      ts.forEachChild(node, visit);
    })(file);
  }
  return { exact, prefixes, missing };
}

// The worker's alert templates read their wording from the same catalog
// (alerts.*); any phrase written into the file itself fails here.
function alertTemplatePhrases(): string[] {
  const path = join(WEB, "../worker/src/alerts/templates.ts");
  const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  (function visit(node: ts.Node) {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !ts.isImportDeclaration(node.parent) && readsAsText(node.text)) {
      found.push(node.text);
    }
    ts.forEachChild(node, visit);
  })(file);
  return found;
}

// Where the API and worker put words in front of a person: an HTTP refusal
// (new SomethingException(...), whose body must come from apiError), a
// socket's { error } reply, and a Telegram message (ctx.reply or
// sendMessage). A phrase anywhere inside one of those, however it is
// built, fails. Log lines, job outcomes and embedding text are for
// operators and the model, and pass.
function serverPhrases(): string[] {
  const found: string[] = [];
  const speaks = (node: ts.Node): boolean => {
    for (let n: ts.Node | undefined = node.parent; n && !ts.isBlock(n) && !ts.isSourceFile(n); n = n.parent) {
      if (ts.isNewExpression(n) && /Exception$/.test(n.expression.getText())) return true;
      if (ts.isCallExpression(n) && /(\.reply|sendMessage)$/.test(n.expression.getText())) return true;
      if (ts.isPropertyAssignment(n) && n.name.getText() === "error" && ts.isObjectLiteralExpression(n.parent) && ts.isReturnStatement(n.parent.parent)) return true;
    }
    return false;
  };
  for (const root of SERVER_SOURCES) {
    for (const path of files(join(WEB, root))) {
      const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      (function visit(node: ts.Node) {
        const text = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
          ? node.text
          : ts.isTemplateExpression(node)
            ? node.head.text + node.templateSpans.map((span) => span.literal.text).join(" ")
            : null;
        if (text !== null && readsAsText(text) && speaks(node) && !ignoredLine(file, node)) {
          const { line } = file.getLineAndCharacterOfPosition(node.getStart());
          found.push(`${relative(join(WEB, ".."), path)}:${line + 1}  ${JSON.stringify(text.slice(0, 70))}`);
        }
        ts.forEachChild(node, visit);
      })(file);
    }
  }
  return found;
}

describe("internationalisation", () => {
  it("has no hardcoded words where the API and worker speak to a person", () => {
    expect(serverPhrases()).toEqual([]);
  });

  it("keeps the worker's alert wording in the catalog too", () => {
    expect(alertTemplatePhrases()).toEqual([]);
  });

  it("has no hardcoded user-facing strings in the web app", () => {
    expect(hardcoded()).toEqual([]);
  });

  it("formats dates, money and distances through the page's locale", () => {
    expect(bareFormatterImports()).toEqual([]);
  });

  it("only uses keys the catalog has", () => {
    expect(usedKeys().missing).toEqual([]);
  });

  it("has no catalog keys that nothing uses", () => {
    const { exact, prefixes } = usedKeys();
    const unused = leaves(catalog).filter(
      (key) => !SERVER_NAMESPACES.has(key.split(".")[0]) && !exact.has(key) && ![...prefixes].some((p) => p === "" || key.startsWith(`${p}.`)),
    );
    expect(unused).toEqual([]);
  });
});
