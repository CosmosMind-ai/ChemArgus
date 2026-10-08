// Aggregate per-problem grading-result.json into summary.json and a Markdown report.
// Usage: node summarize.mjs <dataRoot> <runsRoot> <outMd>
import fs from "node:fs";
import path from "node:path";

const [dataRoot, runsRoot, outMd] = process.argv.slice(2);
if (!dataRoot || !runsRoot || !outMd) {
  console.error("usage: node summarize.mjs <dataRoot> <runsRoot> <outMd>");
  process.exit(2);
}

const PROTOCOLS = ["full_problem", "sequential_carry", "oracle_scaffolded"];

// collect grading-result.json per problem
const perProblem = [];
for (const pid of fs.readdirSync(runsRoot).sort()) {
  const gr = path.join(runsRoot, pid, "grading-result.json");
  if (!fs.existsSync(gr)) continue;
  const g = JSON.parse(fs.readFileSync(gr, "utf-8"));
  perProblem.push({ pid, g });
}
perProblem.sort((a, b) => (a.g.problem_id || "").localeCompare(b.g.problem_id || ""));

function protoScores(g) {
  const out = {};
  for (const pr of PROTOCOLS) {
    const p = g.protocols?.[pr];
    out[pr] = p ? { score: p.score ?? null, full_mark: p.full_mark ?? 0, normalized: p.normalized ?? null, complete: !!p.complete } : { score: null, full_mark: 0, normalized: null, complete: false };
  }
  return out;
}

// model / judge / input-mode labels from the first grading result (same run)
const first = perProblem[0]?.g;
const modelLabel = first?.model
  ? `${first.model.provider}/${first.model.modelId} (${first.model.inputMode}, thinking: ${first.model.thinkingLevel})`
  : "(unknown model)";
const judgeLabel = first?.judge ?? "(unknown judge)";

// aggregate
const agg = { total: { full_mark: 0, full_problem: 0, sequential_carry: 0, oracle_scaffolded: 0, n: 0 } };
for (const pp of perProblem) {
  const s = protoScores(pp.g);
  const mk = pp.g.total_mark ?? 0;
  agg.total.full_mark += mk;
  agg.total.n++;
  for (const pr of PROTOCOLS) {
    if (Number.isFinite(s[pr].score)) agg.total[pr] += s[pr].score;
  }
}

function pct(score, mark) {
  if (!mark) return "—";
  return `${score}/${mark} (${((score / mark) * 100).toFixed(2)}%)`;
}

// ---- build markdown ----
const lines = [];
lines.push("# ChemArgus Evaluation Results");
lines.push("");
lines.push(`> Model: \`${modelLabel}\`; tools: \`[]\` (no web access); protocols: full_problem / sequential_carry / oracle_scaffolded (independent sessions)`);
lines.push(`> Data directory: \`${dataRoot}\`; grading: ${judgeLabel} (isolated session per call, per subquestion, per protocol)`);
lines.push(`> Generated at: ${new Date().toISOString()}`);
lines.push("");

// per-problem table
lines.push("## 1. Per-Problem Scores");
lines.push("");
lines.push("| Problem | Subquestions | Full Mark | full_problem | sequential_carry | oracle_scaffolded |");
lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
for (const pp of perProblem) {
  const g = pp.g;
  const s = protoScores(g);
  const nsub = Object.keys(g.protocols?.full_problem?.subs || g.protocols?.sequential_carry?.subs || {}).length;
  const f = (x) => (Number.isFinite(x?.score) ? pct(x.score, x.full_mark) : "—");
  lines.push(`| ${g.problem_id} | ${nsub} | ${g.total_mark} | ${f(s.full_problem)} | ${f(s.sequential_carry)} | ${f(s.oracle_scaffolded)} |`);
}
lines.push("");

// overall
lines.push("## 2. Overall");
lines.push("");
lines.push("| Problems | Full Mark | full_problem | sequential_carry | oracle_scaffolded |");
lines.push("| ---: | ---: | ---: | ---: | ---: |");
lines.push(`| ${agg.total.n} | ${agg.total.full_mark} | ${pct(agg.total.full_problem, agg.total.full_mark)} | ${pct(agg.total.sequential_carry, agg.total.full_mark)} | ${pct(agg.total.oracle_scaffolded, agg.total.full_mark)} |`);
lines.push("");

lines.push("## 3. Artifacts");
lines.push("");
lines.push(`- Per-problem, per-protocol raw input/output/sessions: \`${runsRoot}/<problem_id>/<protocol>/\``);
lines.push("- Per-problem grading: \`<problem_id>/grading-result.json\`");
lines.push(`- Per-problem summary: \`${runsRoot}/per-problem-results.jsonl\``);
lines.push("");

fs.writeFileSync(outMd, lines.join("\n"), "utf-8");

// summary.json
fs.writeFileSync(path.join(runsRoot, "summary.json"), JSON.stringify({ model: modelLabel, judge: judgeLabel, agg, per_problem: perProblem.map((p) => ({ problem_id: p.g.problem_id, total_mark: p.g.total_mark, ...protoScores(p.g) })) }, null, 2), "utf-8");

console.log(`Wrote ${outMd}`);
console.log(`Overall: fp=${pct(agg.total.full_problem, agg.total.full_mark)}  seq=${pct(agg.total.sequential_carry, agg.total.full_mark)}  ora=${pct(agg.total.oracle_scaffolded, agg.total.full_mark)}`);
console.log(`Problems graded: ${perProblem.length}`);
