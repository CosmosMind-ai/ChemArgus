// Grading runner: rubric-grounded judge for every subquestion of every completed
// problem, across all three protocols. Resumable per problem.
// Usage: node grade_all.mjs <dataRoot> <runsRoot> [concurrency]
import fs from "node:fs";
import path from "node:path";
import * as L from "./lib.mjs";
import * as J from "./judge.mjs";

const [dataRoot, runsRoot, concStr] = process.argv.slice(2);
if (!dataRoot || !runsRoot) {
  console.error("usage: node grade_all.mjs <dataRoot> <runsRoot> [concurrency]");
  process.exit(2);
}
const CONCURRENCY = Math.max(1, parseInt(concStr || "3", 10) || 3);

const PROTOCOLS = ["full_problem", "sequential_carry", "oracle_scaffolded"];
const FULL_NOTE = "The student answered a multi-part problem in ONE response. Locate and grade ONLY the part that answers the subquestion above; ignore the other subquestions' parts.";

// ---- enumerate completed problems ----
const problems = [];
for (const pid of fs.readdirSync(dataRoot).sort()) {
  const tdir = path.join(dataRoot, pid);
  if (!fs.statSync(tdir).isDirectory()) continue;
  const jsonPath = path.join(tdir, "problem.json");
  if (!fs.existsSync(jsonPath)) continue;
  const outDir = path.join(runsRoot, pid);
  const complete = PROTOCOLS.every((pr) => fs.existsSync(path.join(outDir, pr, "parsed-answers.json")));
  if (!complete) continue;
  const grPath = path.join(outDir, "grading-result.json");
  if (fs.existsSync(grPath)) {
    // skip only if fully graded (no null scores)
    try {
      const g = JSON.parse(fs.readFileSync(grPath, "utf-8"));
      const fullyGraded = PROTOCOLS.every((pr) => g.protocols?.[pr]?.complete);
      if (fullyGraded) continue;
    } catch {
      /* re-grade */
    }
  }
  problems.push({ pid, jsonPath, outDir });
}
console.log(`Found ${problems.length} problems to grade.`);

function readAnswers(problem, protocol) {
  const dir = path.join(problem.outDir, protocol);
  const pa = JSON.parse(fs.readFileSync(path.join(dir, "parsed-answers.json"), "utf-8"));
  if (protocol === "full_problem") {
    return { fullBlob: pa.raw };
  }
  return { perSub: pa.parsed };
}

// Build judge jobs
const jobs = [];
for (const p of problems) {
  const prob = L.loadProblem(p.jsonPath);
  const answers = {};
  for (const pr of PROTOCOLS) answers[pr] = readAnswers(p, pr);
  for (const sub of prob.subquestions) {
    for (const pr of PROTOCOLS) {
      const answer = pr === "full_problem" ? answers[pr].fullBlob : (answers[pr].perSub[sub.sub_id] ?? "");
      const note = pr === "full_problem" ? FULL_NOTE : "";
      jobs.push({ p, prob, sub, pr, answer, note });
    }
  }
}
console.log(`Total judge jobs: ${jobs.length}`);
const results = new Array(jobs.length);

const resultsFile = path.join(runsRoot, "grade-progress.jsonl");
function logGrade(rec) {
  fs.appendFileSync(resultsFile, JSON.stringify(rec) + "\n", "utf-8");
}

let done = 0, failed = 0;

async function judgeJob(job, idx) {
  const t0 = Date.now();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { parsed } = await J.judgeOne(job.sub, job.answer, job.note);
      let score = Number(parsed.score);
      if (!Number.isFinite(score)) score = 0;
      score = Math.min(Math.max(0, Math.round(score)), job.sub.full_mark);
      const rec = {
        sub_id: job.sub.sub_id,
        protocol: job.pr,
        full_mark: job.sub.full_mark,
        score,
        confidence: Number(parsed.confidence),
        error_types: parsed.error_types,
        deductions: parsed.deductions,
        judge: parsed,
      };
      results[idx] = rec;
      done++;
      logGrade({ ts: new Date().toISOString(), task: `${job.p.pid}/${job.sub.sub_id}/${job.pr}`, status: "ok", score, full_mark: job.sub.full_mark, seconds: ((Date.now() - t0) / 1000).toFixed(1) });
      process.stdout.write(`[${idx}] graded ${job.p.pid}/${job.sub.sub_id}/${job.pr} = ${score}/${job.sub.full_mark}  [${done + failed}/${jobs.length}]\n`);
      return rec;
    } catch (e) {
      if (attempt === 3) {
        failed++;
        logGrade({ ts: new Date().toISOString(), task: `${job.p.pid}/${job.sub.sub_id}/${job.pr}`, status: "error", error: String(e?.message || e) });
        process.stdout.write(`[${idx}] JUDGE-ERROR ${job.p.pid}/${job.sub.sub_id}/${job.pr}: ${e?.message || e}  [${done + failed}/${jobs.length}]\n`);
        const errRec = { sub_id: job.sub.sub_id, protocol: job.pr, full_mark: job.sub.full_mark, score: null, error: String(e?.message || e) };
        results[idx] = errRec;
        return errRec;
      }
      process.stdout.write(`[${idx}] retry ${attempt} for ${job.p.pid}/${job.sub.sub_id}/${job.pr}: ${e?.message || e}\n`);
    }
  }
}

// ---- worker pool ----
let next = 0;
async function worker(wid) {
  while (next < jobs.length) {
    const i = next++;
    await judgeJob(jobs[i], i);
  }
}
const workers = [];
for (let w = 0; w < Math.min(CONCURRENCY, jobs.length); w++) workers.push(worker(w));
await Promise.all(workers);

// ---- aggregate per problem and persist ----
const byProblem = new Map();
for (let i = 0; i < jobs.length; i++) {
  const job = jobs[i];
  const key = job.p.outDir;
  if (!byProblem.has(key)) byProblem.set(key, { problem: job.prob, outDir: key });
  const rec = results[i] || { sub_id: job.sub.sub_id, protocol: job.pr, full_mark: job.sub.full_mark, score: null, error: "missing" };
  byProblem.get(key)[`${job.sub.sub_id}::${job.pr}`] = rec;
}

const summaryLines = [];
for (const { problem, outDir } of byProblem.values()) {
  const totalMark = problem.subquestions.reduce((a, s) => a + s.full_mark, 0);
  const proto = {};
  for (const pr of PROTOCOLS) {
    let score = 0, full = 0, ok = true;
    const subs = {};
    for (const s of problem.subquestions) {
      const rec = byProblem.get(outDir)[`${s.sub_id}::${pr}`];
      subs[s.sub_id] = rec;
      full += s.full_mark;
      if (rec && Number.isFinite(rec.score)) score += rec.score;
      else ok = false;
    }
    proto[pr] = { score, full_mark: full, normalized: full ? score / full : null, complete: ok, subs };
  }
  const grad = {
    problem_id: problem.problem_id,
    dataset: dataRoot,
    model: L.CONFIG,
    judge: `${L.CONFIG.judgeModelId} rubric-grounded (isolated session per call)`,
    graded_at: new Date().toISOString(),
    total_mark: totalMark,
    protocols: proto,
  };
  L.writeJson(path.join(outDir, "grading-result.json"), grad);
  summaryLines.push({
    problem_id: problem.problem_id,
    total_mark: totalMark,
    full_problem: proto.full_problem.normalized,
    sequential_carry: proto.sequential_carry.normalized,
    oracle_scaffolded: proto.oracle_scaffolded.normalized,
  });
  const fp = proto.full_problem, sc = proto.sequential_carry, oc = proto.oracle_scaffolded;
  console.log(`${problem.problem_id}: fp=${fp.score}/${fp.full_mark} (${(fp.normalized * 100).toFixed(1)}%)  seq=${sc.score}/${sc.full_mark} (${(sc.normalized * 100).toFixed(1)}%)  ora=${oc.score}/${oc.full_mark} (${(oc.normalized * 100).toFixed(1)}%)`);
}
fs.writeFileSync(path.join(runsRoot, "per-problem-results.jsonl"), summaryLines.map((x) => JSON.stringify(x)).join("\n") + "\n", "utf-8");

console.log(`\n=== GRADING DONE === done=${done} failed=${failed}`);
