// Run the three evaluation protocols for one ChemArgus problem.
// Usage: node run_problem.mjs <problem.json> <output-dir>
import fs from "node:fs";
import path from "node:path";
import * as L from "./lib.mjs";

const [jsonPath, outDir] = process.argv.slice(2);
if (!jsonPath || !outDir) {
  console.error("usage: node run_problem.mjs <problem.json> <output-dir> [--only <protocol>]");
  process.exit(2);
}
// optional --only full_problem|sequential_carry|oracle_scaffolded
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

const problem = L.loadProblem(jsonPath);
const pid = problem.problem_id;
console.log(`\n=== Problem ${pid} ===`);
console.log(`subquestions: ${problem.subquestions.length}, total marks: ${problem.subquestions.reduce((a, s) => a + s.full_mark, 0)}`);

const startedAt = new Date().toISOString();

function subDir(protocol) {
  return path.join(outDir, protocol);
}

async function saveProtocol(protocol, turns) {
  const dir = L.ensureDir(subDir(protocol));
  // turns: array of {role, text}
  const input = {
    protocol,
    problem_id: pid,
    input_mode: L.CONFIG.inputMode,
    model: `${L.CONFIG.provider}/${L.CONFIG.modelId}`,
    thinking_level: L.CONFIG.thinkingLevel,
    started_at: startedAt,
    turns,
  };
  L.writeJson(path.join(dir, "input.json"), input);

  const session = await L.createIsolatedSession();
  const outputs = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const answer = await L.ask(session, t.text);
    outputs.push({ index: i, role: "assistant", text: answer });
    L.appendJsonl(path.join(dir, "answer-session.jsonl"), { turn: i, user: t.text, assistant: answer });
    console.log(`  [${protocol}] turn ${i} answered (${answer.length} chars)`);
  }
  session.dispose();

  L.writeJson(path.join(dir, "model-output.json"), {
    protocol,
    problem_id: pid,
    outputs,
  });
  return outputs;
}

// ---- full_problem ----
if (!only || only === "full_problem") {
  const prompt = L.buildFullProblemPrompt(problem);
  const outputs = await saveProtocol("full_problem", [{ role: "user", text: prompt }]);
  L.writeJson(path.join(subDir("full_problem"), "parsed-answers.json"), {
    protocol: "full_problem",
    raw: outputs[0].text,
    note: "single-shot answer; per-sub_id parsing is done during grading",
  });
}

// ---- sequential_carry ----
if (!only || only === "sequential_carry") {
  const turns = [{ role: "user", text: L.buildHeaderBlock(problem) + "\n\nNow answer this subquestion:\n" + L.buildSubquestionText(problem.subquestions[0]) }];
  for (let k = 1; k < problem.subquestions.length; k++) {
    turns.push({ role: "user", text: "Next subquestion:\n" + L.buildSubquestionText(problem.subquestions[k]) });
  }
  const outputs = await saveProtocol("sequential_carry", turns);
  const parsed = {};
  problem.subquestions.forEach((s, i) => (parsed[s.sub_id] = outputs[i]?.text ?? ""));
  L.writeJson(path.join(subDir("sequential_carry"), "parsed-answers.json"), { protocol: "sequential_carry", parsed });
}

// ---- oracle_scaffolded ----
if (!only || only === "oracle_scaffolded") {
  const turns = [{ role: "user", text: L.buildHeaderBlock(problem) + "\n\nNow answer this subquestion:\n" + L.buildSubquestionText(problem.subquestions[0]) }];
  for (let k = 1; k < problem.subquestions.length; k++) {
    const prev = problem.subquestions[k - 1];
    const scaffold = L.standardAnswerFor(prev);
    turns.push({
      role: "user",
      text:
        `The correct answer for the previous subquestion (${prev.sub_id}) is:\n${scaffold}\n\n` +
        `Now answer this subquestion:\n${L.buildSubquestionText(problem.subquestions[k])}`,
    });
  }
  const outputs = await saveProtocol("oracle_scaffolded", turns);
  const parsed = {};
  problem.subquestions.forEach((s, i) => (parsed[s.sub_id] = outputs[i]?.text ?? ""));
  L.writeJson(path.join(subDir("oracle_scaffolded"), "parsed-answers.json"), { protocol: "oracle_scaffolded", parsed });
}

// ---- manifest ----
L.writeJson(path.join(outDir, "manifest.json"), {
  dataset_version: "ChemArgus",
  problem_id: pid,
  sub_ids: problem.subquestions.map((s) => s.sub_id),
  model: L.CONFIG,
  protocols: ["full_problem", "sequential_carry", "oracle_scaffolded"],
  started_at: startedAt,
  ended_at: new Date().toISOString(),
  status: "completed",
});

console.log(`\nDone. Artifacts in ${outDir}`);
