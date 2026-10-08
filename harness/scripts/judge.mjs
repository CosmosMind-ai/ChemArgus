// Rubric-grounded LLM judge (separate isolated session per call).
import * as L from "./lib.mjs";

export const JUDGE_SYSTEM_PROMPT =
  "You are a strict, careful chemistry grading judge for an olympiad-level benchmark. " +
  "You grade student answers against official rubrics. You output strict JSON only.";

export function buildJudgePrompt(sub, answer, extraNote = "") {
  const q = [`Subquestion ID: ${sub.sub_id}`, `Question: ${sub.text_open}`];
  if (sub.text_images?.length) {
    q.push("Question images (text descriptions):");
    q.push(L.imagesToText(sub.text_images));
  }
  const rubric = sub.rubric.map((r, i) => `[Rubric point ${i + 1}] ${r}`).join("\n");
  const rubricImgs = sub.rubric_images?.length
    ? `\nRubric images (text descriptions):\n${L.imagesToText(sub.rubric_images)}`
    : "";
  const note = extraNote ? `\n\n--- NOTE ---\n${extraNote}` : "";

  return `Grade the STUDENT ANSWER below against the OFFICIAL RUBRIC. The full mark for this subquestion is ${sub.full_mark}.

--- QUESTION ---
${q.join("\n")}

--- STUDENT ANSWER ---
${answer || "(empty answer)"}
${note}

--- OFFICIAL RUBRIC ---
${rubric}
${rubricImgs}

--- GRADING RULES ---
1. Compare the student answer with the rubric by CHEMICAL MEANING / EQUIVALENCE, not by exact wording. Allow equivalent notation: equivalent SMILES that encode the same connectivity/structure, equivalent chemical equations, LaTeX/Unicode/whitespace differences, alternative-but-equivalent names.
2. Award partial credit exactly as the rubric specifies (e.g. "1 point if the equation is unbalanced", "no credit for ...", "stereochemistry not required").
3. Do NOT award credit for content the student did not write; do NOT infer unstated steps; do NOT fill in missing work.
4. Do NOT move marks between rubric points.
5. For structure/SMILES answers, check atom connectivity, charges, bond order and (where required) stereochemistry; a different string that encodes the same structure is equivalent, but different connectivity/regiochemistry/stereochemistry is NOT.
6. The total score must be a non-negative integer between 0 and ${sub.full_mark}.

Output STRICT JSON only (no markdown fences, no extra text), exactly this shape:
{"score": <int>, "full_mark": ${sub.full_mark}, "rubric_points": [{"index": 1, "awarded": <int>, "evidence": "<direct quote or short paraphrase from the student answer>", "reason": "<why awarded or deducted>"}], "deductions": ["<short reason>"], "error_types": ["<short error type, e.g. balancing error / wrong connectivity / missing species>"], "confidence": <0.0 to 1.0>}`;
}

export function extractJson(text) {
  let t = String(text).replace(/```json/gi, "```").replace(/```/g, "");
  const start = t.indexOf("{");
  if (start < 0) throw new Error("judge output has no JSON object");
  let depth = 0;
  for (let i = start; i < t.length; i++) {
    if (t[i] === "{") depth++;
    else if (t[i] === "}") {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  throw new Error("judge output has unbalanced JSON");
}

// Judge one (subquestion, answer). Returns {raw, parsed}.
// On non-JSON output, asks a follow-up in the same session for valid JSON.
export async function judgeOne(sub, answer, extraNote = "") {
  const session = await L.createIsolatedSession(JUDGE_SYSTEM_PROMPT);
  try {
    const raw = await L.ask(session, buildJudgePrompt(sub, answer, extraNote));
    try {
      return { raw, parsed: JSON.parse(extractJson(raw)) };
    } catch (e) {
      const raw2 = await L.ask(session,
        "Your previous response was not valid JSON or contained no JSON object. " +
        "Output ONLY the JSON object now — no markdown fences, no explanation, no extra text.");
      return { raw: raw + "\n===RETRY===\n" + raw2, parsed: JSON.parse(extractJson(raw2)) };
    }
  } finally {
    session.dispose();
  }
}
