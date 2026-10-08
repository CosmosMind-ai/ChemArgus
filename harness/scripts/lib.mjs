// Shared helpers for ChemArgus evaluation via the Pi SDK.
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Resolve the Pi SDK entry. Set PI_SDK_ENTRY to the absolute path of
// @earendil-works/pi-coding-agent/dist/index.js if the package is not
// installed in the current node_modules.
function resolvePiSdk() {
  if (process.env.PI_SDK_ENTRY) {
    return pathToFileURL(path.resolve(process.env.PI_SDK_ENTRY)).href;
  }
  try {
    const req = createRequire(path.join(process.cwd(), "package.json"));
    return pathToFileURL(req.resolve("@earendil-works/pi-coding-agent/dist/index.js")).href;
  } catch {
    throw new Error(
      "Pi SDK not found. Install @earendil-works/pi-coding-agent in this repo " +
      "or set PI_SDK_ENTRY to the absolute path of dist/index.js."
    );
  }
}

const PKG = resolvePiSdk();

export const {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  DefaultResourceLoader,
  getAgentDir,
} = await import(PKG);

// ---- Config for this evaluation run (env-overridable) ----
export const CONFIG = {
  provider: process.env.PI_PROVIDER ?? "deepseek",
  modelId: process.env.PI_MODEL_ID ?? "deepseek-v4-pro",
  thinkingLevel: process.env.PI_THINKING_LEVEL ?? "medium",
  inputMode: process.env.PI_INPUT_MODE ?? "text_description", // model is text-only; images delivered as JSON `description` text
  judgeModelId: process.env.PI_JUDGE_MODEL_ID ?? "deepseek-v4-pro",
  tools: [], // no tools (no web search, no shell) for answering agent
  systemPrompt:
    "You are an expert chemistry problem solver taking part in a chemistry benchmark. " +
    "Answer each question precisely and completely. " +
    "Write chemical equations and formulas with standard notation (e.g., H_2O, NaCN, CO_2). " +
    "Where a structure is requested, give a SMILES string. " +
    "Briefly show key reasoning, then give a clearly labeled final answer for every requested item. " +
    "Do not use any tools and do not search the internet.",
};

let _runtimePromise = null;
export function getRuntime() {
  if (!_runtimePromise) _runtimePromise = ModelRuntime.create();
  return _runtimePromise;
}

export function getModel() {
  const rt = getRuntime();
  return rt.then((r) => r.getModel(CONFIG.provider, CONFIG.modelId));
}

// Create a clean, isolated session (no context files, no skills, no tools).
// Optional custom system prompt (e.g. for the judge).
export async function createIsolatedSession(systemPrompt = CONFIG.systemPrompt) {
  const modelRuntime = await getRuntime();
  const model = modelRuntime.getModel(CONFIG.provider, CONFIG.modelId);
  if (!model) throw new Error(`model not found: ${CONFIG.provider}/${CONFIG.modelId}`);

  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    systemPromptOverride: () => systemPrompt,
    appendSystemPromptOverride: () => [],
    skillsOverride: () => ({ skills: [], diagnostics: [] }),
    promptsOverride: () => ({ prompts: [], diagnostics: [] }),
    agentsFilesOverride: () => ({ agentsFiles: [] }),
  });
  await loader.reload();

  const { session } = await createAgentSession({
    model,
    thinkingLevel: CONFIG.thinkingLevel,
    modelRuntime,
    tools: [],
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(),
  });
  return session;
}

// Send a prompt and return the assistant's final text (no thinking deltas).
export function ask(session, text) {
  let buf = "";
  const unsub = session.subscribe((ev) => {
    if (ev.type === "message_update" && ev.assistantMessageEvent.type === "text_delta") {
      buf += ev.assistantMessageEvent.delta;
    }
  });
  return session.prompt(text).then(() => {
    unsub();
    return buf.trim();
  });
}

// ---- Problem loading / prompt building ----

// Accept both a bare problem object and the legacy single-element array.
export function loadProblem(jsonPath) {
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  return Array.isArray(raw) ? raw[0] : raw;
}

// Render image list as text descriptions (text_description input mode).
export function imagesToText(images) {
  if (!images || images.length === 0) return "";
  return images.map((im) => `[Image "${im.file}": ${im.description}]`).join("\n");
}

export function buildFullProblemPrompt(problem) {
  const lines = [];
  lines.push("Solve the following complete chemistry problem. Answer ALL subquestions in one response.");
  lines.push("Label each answer clearly with its subquestion ID.");
  lines.push("");
  lines.push(`Problem ID: ${problem.problem_id}`);
  lines.push(`Background/Header: ${problem.header}`);
  if (problem.header_images?.length) {
    lines.push("Header images:");
    lines.push(imagesToText(problem.header_images));
  }
  lines.push("");
  lines.push("Subquestions:");
  for (const s of problem.subquestions) {
    lines.push(`--- ${s.sub_id} (${s.full_mark} marks) ---`);
    lines.push(s.text_open);
    if (s.text_images?.length) {
      lines.push("Provided images:");
      lines.push(imagesToText(s.text_images));
    }
    lines.push("");
  }
  lines.push("Provide your answers below, one labeled block per subquestion.");
  return lines.join("\n");
}

export function buildHeaderBlock(problem) {
  const lines = [];
  lines.push(`Problem ID: ${problem.problem_id}`);
  lines.push(`Background/Header: ${problem.header}`);
  if (problem.header_images?.length) {
    lines.push("Header images:");
    lines.push(imagesToText(problem.header_images));
  }
  return lines.join("\n");
}

export function buildSubquestionText(s) {
  const lines = [s.text_open];
  if (s.text_images?.length) {
    lines.push("Provided images:");
    lines.push(imagesToText(s.text_images));
  }
  return lines.join("\n");
}

// Build the user turns for a protocol (all turns belong to one continuous session).
export function buildTurns(problem, protocol) {
  if (protocol === "full_problem") {
    return [{ role: "user", text: buildFullProblemPrompt(problem) }];
  }
  if (protocol === "sequential_carry") {
    const turns = [
      { role: "user", text: buildHeaderBlock(problem) + "\n\nNow answer this subquestion:\n" + buildSubquestionText(problem.subquestions[0]) },
    ];
    for (let k = 1; k < problem.subquestions.length; k++) {
      turns.push({ role: "user", text: "Next subquestion:\n" + buildSubquestionText(problem.subquestions[k]) });
    }
    return turns;
  }
  if (protocol === "oracle_scaffolded") {
    const turns = [
      { role: "user", text: buildHeaderBlock(problem) + "\n\nNow answer this subquestion:\n" + buildSubquestionText(problem.subquestions[0]) },
    ];
    for (let k = 1; k < problem.subquestions.length; k++) {
      const prev = problem.subquestions[k - 1];
      const scaffold = standardAnswerFor(prev);
      turns.push({
        role: "user",
        text:
          `The correct answer for the previous subquestion (${prev.sub_id}) is:\n${scaffold}\n\n` +
          `Now answer this subquestion:\n${buildSubquestionText(problem.subquestions[k])}`,
      });
    }
    return turns;
  }
  throw new Error("unknown protocol " + protocol);
}

// Run one protocol for a problem in a fresh isolated session; persist artifacts;
// return the per-turn assistant texts.
export async function runProtocol(problem, protocol, outDir, log = () => {}) {
  const dir = ensureDir(path.join(outDir, protocol));
  const turns = buildTurns(problem, protocol);
  writeJson(path.join(dir, "input.json"), {
    protocol,
    problem_id: problem.problem_id,
    input_mode: CONFIG.inputMode,
    model: `${CONFIG.provider}/${CONFIG.modelId}`,
    thinking_level: CONFIG.thinkingLevel,
    started_at: new Date().toISOString(),
    turns,
  });

  const session = await createIsolatedSession();
  const outputs = [];
  try {
    for (let i = 0; i < turns.length; i++) {
      const answer = await ask(session, turns[i].text);
      outputs.push({ index: i, role: "assistant", text: answer });
      appendJsonl(path.join(dir, "answer-session.jsonl"), { turn: i, user: turns[i].text, assistant: answer });
      log(`  [${protocol}] turn ${i} answered (${answer.length} chars)`);
    }
  } finally {
    session.dispose();
  }

  writeJson(path.join(dir, "model-output.json"), { protocol, problem_id: problem.problem_id, outputs });

  const parsed = {};
  if (protocol === "full_problem") {
    parsed.raw = outputs[0]?.text ?? "";
    parsed.note = "single-shot answer; per-sub_id parsing done during grading";
  } else {
    problem.subquestions.forEach((s, i) => (parsed[s.sub_id] = outputs[i]?.text ?? ""));
  }
  writeJson(path.join(dir, "parsed-answers.json"), { protocol, ...(protocol === "full_problem" ? { raw: parsed.raw, note: parsed.note } : { parsed }) });
  return outputs;
}

// Standard answer for oracle scaffolding: first accepted rubric line, cleaned of
// point annotations and private scoring notes (no-credit / award hints).
export function standardAnswerFor(sub) {
  if (!sub.rubric || sub.rubric.length === 0) return "(no rubric available)";
  let t = sub.rubric[0];
  // strip point annotations like "(2 points)", "(2 points; * denotes ...)"
  t = t.replace(/\(\d+\s*points?(?:[;:][^)]*)?\)/gi, "");
  // cut off private scoring hints that follow the standard conclusion
  const cut = t.search(/no credit|award|no points|points? (are|will|may)/i);
  if (cut > 0) t = t.slice(0, cut);
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

// ---- Small JSONL/file helpers ----
export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf-8");
}

export function appendJsonl(file, obj) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf-8");
}

export function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
