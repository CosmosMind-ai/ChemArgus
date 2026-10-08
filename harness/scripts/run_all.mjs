// Batch runner: run all 3 protocols for all problems in a dataset with a small
// worker pool. Resumable: skips (problem, protocol) whose model-output.json exists.
// Usage: node run_all.mjs <dataRoot> <runsRoot> [concurrency]
// <dataRoot> is the repository tasks/ directory (one subdirectory per problem).
import fs from "node:fs";
import path from "node:path";
import * as L from "./lib.mjs";

const [dataRoot, runsRoot, concStr] = process.argv.slice(2);
if (!dataRoot || !runsRoot) {
  console.error("usage: node run_all.mjs <dataRoot> <runsRoot> [concurrency]");
  process.exit(2);
}
const CONCURRENCY = Math.max(1, parseInt(concStr || "3", 10) || 3);

// ---- enumerate problems ----
const problems = [];
for (const pid of fs.readdirSync(dataRoot).sort()) {
  const tdir = path.join(dataRoot, pid);
  if (!fs.statSync(tdir).isDirectory()) continue;
  const jsonPath = path.join(tdir, "problem.json");
  if (!fs.existsSync(jsonPath)) continue;
  problems.push({ pid, jsonPath });
}
console.log(`Found ${problems.length} problems.`);

const PROTOCOLS = ["full_problem", "sequential_carry", "oracle_scaffolded"];

function taskDir(t) {
  return path.join(runsRoot, t.pid);
}
function donePath(t) {
  return path.join(taskDir(t), t.proto, "model-output.json");
}

const tasks = [];
for (const p of problems) {
  for (const proto of PROTOCOLS) tasks.push({ ...p, proto });
}
const todo = tasks.filter((t) => !fs.existsSync(donePath(t)));
console.log(`${tasks.length} total tasks; ${todo.length} remaining; ${tasks.length - todo.length} already done.`);

// ---- progress tracking ----
const progressFile = path.join(runsRoot, "progress.jsonl");
function logProgress(rec) {
  fs.appendFileSync(progressFile, JSON.stringify(rec) + "\n", "utf-8");
}

let completed = 0;
let failed = 0;
const startedAll = new Date().toISOString();

async function runTask(t, idx) {
  const t0 = Date.now();
  try {
    const problem = L.loadProblem(t.jsonPath);
    const outDir = taskDir(t);
    await L.runProtocol(problem, t.proto, outDir, (m) => process.stdout.write(`[${idx}] ${t.pid} ${m}\n`));
    // write problem manifest when all three protocols are done
    const allDone = PROTOCOLS.every((pr) => fs.existsSync(path.join(outDir, pr, "model-output.json")));
    if (allDone) {
      L.writeJson(path.join(outDir, "manifest.json"), {
        dataset: dataRoot,
        dataset_version: "ChemArgus",
        problem_id: problem.problem_id,
        sub_ids: problem.subquestions.map((s) => s.sub_id),
        model: L.CONFIG,
        protocols: PROTOCOLS,
        started_at: startedAll,
        ended_at: new Date().toISOString(),
        status: "completed",
      });
    }
    completed++;
    const rec = { ts: new Date().toISOString(), task: `${t.pid}/${t.proto}`, status: "ok", seconds: ((Date.now() - t0) / 1000).toFixed(1) };
    logProgress(rec);
    process.stdout.write(`[${idx}] DONE ${t.pid}/${t.proto} (${rec.seconds}s)  [${completed + failed}/${todo.length}]\n`);
  } catch (e) {
    failed++;
    const errFile = path.join(taskDir(t), "error.json");
    L.writeJson(errFile, { task: `${t.pid}/${t.proto}`, error: String(e?.message || e), ts: new Date().toISOString(), retryable: true });
    logProgress({ ts: new Date().toISOString(), task: `${t.pid}/${t.proto}`, status: "error", error: String(e?.message || e) });
    process.stdout.write(`[${idx}] ERROR ${t.pid}/${t.proto}: ${e?.message || e}  [${completed + failed}/${todo.length}]\n`);
  }
}

// ---- worker pool ----
let next = 0;
async function worker(wid) {
  while (next < todo.length) {
    const i = next++;
    process.stdout.write(`[worker ${wid}] start ${todo[i].pid}/${todo[i].proto}\n`);
    await runTask(todo[i], i);
  }
}

const workers = [];
for (let w = 0; w < Math.min(CONCURRENCY, todo.length); w++) workers.push(worker(w));
await Promise.all(workers);

console.log(`\n=== BATCH FINISHED === completed=${completed} failed=${failed} total_remaining_was=${todo.length}`);
