import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = process.cwd();
const coveragePath = path.join(repoRoot, "coverage", "coverage-final.json");
const srcRoot = path.join(repoRoot, "src");

if (!fs.existsSync(coveragePath)) {
  console.error("coverage-final.json not found. Run `npm run test:coverage` first.");
  process.exit(1);
}

const coverage = JSON.parse(fs.readFileSync(coveragePath, "utf8"));

function rel(p) {
  return path.relative(repoRoot, p).replaceAll(path.sep, "/");
}

function lineHitsForFile(fileCoverage) {
  const hits = new Map();
  const statementMap = fileCoverage.statementMap || {};
  const counts = fileCoverage.s || {};
  for (const [id, loc] of Object.entries(statementMap)) {
    const count = Number(counts[id] || 0);
    const start = loc.start.line;
    const end = loc.end.line;
    for (let line = start; line <= end; line += 1) {
      hits.set(line, Math.max(hits.get(line) || 0, count));
    }
  }
  return hits;
}

function complexityFor(node) {
  let score = 1;
  function walk(n) {
    if (
      ts.isIfStatement(n) ||
      ts.isForStatement(n) ||
      ts.isForInStatement(n) ||
      ts.isForOfStatement(n) ||
      ts.isWhileStatement(n) ||
      ts.isDoStatement(n) ||
      ts.isCatchClause(n) ||
      ts.isConditionalExpression(n)
    ) score += 1;
    if (ts.isCaseClause(n)) score += 1;
    if (ts.isBinaryExpression(n)) {
      if (
        n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) score += 1;
    }
    ts.forEachChild(n, walk);
  }
  if (node.body) walk(node.body);
  return score;
}

function nodeName(node, sf) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return `<anonymous@${pos.line + 1}>`;
}

function functionNodes(sf) {
  const out = [];
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body) out.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}

const rows = [];
for (const [filePath, fileCoverage] of Object.entries(coverage)) {
  if (!filePath.startsWith(srcRoot) || !filePath.endsWith(".ts")) continue;
  const sourceText = fs.readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const hits = lineHitsForFile(fileCoverage);
  for (const fn of functionNodes(sf)) {
    const start = sf.getLineAndCharacterOfPosition(fn.getStart(sf)).line + 1;
    const end = sf.getLineAndCharacterOfPosition(fn.end).line + 1;
    const lines = [];
    for (let line = start; line <= end; line += 1) lines.push(line);
    const executable = lines.filter((line) => hits.has(line));
    if (executable.length === 0) continue;
    const covered = executable.filter((line) => (hits.get(line) || 0) > 0).length;
    const coveragePct = covered / executable.length;
    const complexity = complexityFor(fn);
    const crap = complexity ** 2 * (1 - coveragePct) ** 3 + complexity;
    rows.push({
      file: rel(filePath),
      name: nodeName(fn, sf),
      start,
      end,
      complexity,
      coveredLines: covered,
      executableLines: executable.length,
      coveragePct,
      crap,
    });
  }
}

rows.sort((a, b) => b.crap - a.crap);
const top = rows.slice(0, 20);
const outDir = path.join(repoRoot, "reports", "crap");
fs.mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, "crap-report.json");
const mdPath = path.join(outDir, "crap-report.md");
fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), totalFunctions: rows.length, top }, null, 2) + "\n");
const md = [
  "# CRAP Report",
  "",
  `- Generated: ${new Date().toISOString()}`,
  `- Functions scored: ${rows.length}`,
  "",
  "| Function | File | Complexity | Coverage | CRAP |",
  "|---|---|---:|---:|---:|",
  ...top.map((r) => `| ${r.name} | ${r.file}:${r.start}-${r.end} | ${r.complexity} | ${(r.coveragePct * 100).toFixed(1)}% | ${r.crap.toFixed(2)} |`),
  "",
].join("\n");
fs.writeFileSync(mdPath, md + "\n");
console.log(md);
