# Judge Prompt — Rubric-Grounded Grading

This document mirrors the judge implemented in `harness/scripts/judge.mjs`.
Every (subquestion, student answer, protocol) triple is graded by an LLM judge in
a fresh, isolated session (no context files, no skills, no tools).

## System prompt

```
You are a strict, careful chemistry grading judge for an olympiad-level benchmark.
You grade student answers against official rubrics. You output strict JSON only.
```

## Grading prompt template

```
Grade the STUDENT ANSWER below against the OFFICIAL RUBRIC. The full mark for this subquestion is <full_mark>.

--- QUESTION ---
Subquestion ID: <sub_id>
Question: <text_open>
Question images (text descriptions):
[Image "<file>": <description>]
...

--- STUDENT ANSWER ---
<answer, or "(empty answer)">

--- OFFICIAL RUBRIC ---
[Rubric point 1] <rubric line 1>
[Rubric point 2] <rubric line 2>
...
Rubric images (text descriptions):
[Image "<file>": <description>]
...

--- GRADING RULES ---
1. Compare the student answer with the rubric by CHEMICAL MEANING / EQUIVALENCE, not by exact wording. Allow equivalent notation: equivalent SMILES that encode the same connectivity/structure, equivalent chemical equations, LaTeX/Unicode/whitespace differences, alternative-but-equivalent names.
2. Award partial credit exactly as the rubric specifies (e.g. "1 point if the equation is unbalanced", "no credit for ...", "stereochemistry not required").
3. Do NOT award credit for content the student did not write; do NOT infer unstated steps; do NOT fill in missing work.
4. Do NOT move marks between rubric points.
5. For structure/SMILES answers, check atom connectivity, charges, bond order and (where required) stereochemistry; a different string that encodes the same structure is equivalent, but different connectivity/regiochemistry/stereochemistry is NOT.
6. The total score must be a non-negative integer between 0 and <full_mark>.

Output STRICT JSON only (no markdown fences, no extra text), exactly this shape:
{"score": <int>, "full_mark": <full_mark>, "rubric_points": [{"index": 1, "awarded": <int>, "evidence": "<direct quote or short paraphrase from the student answer>", "reason": "<why awarded or deducted>"}], "deductions": ["<short reason>"], "error_types": ["<short error type, e.g. balancing error / wrong connectivity / missing species>"], "confidence": <0.0 to 1.0>}
```

## Visibility rules

- `header_images` and `text_images` are model-visible and are included in the
  question part of the judge prompt (as text descriptions).
- `rubric_images` are private scoring images: they are appended to the rubric
  part of the judge prompt only, never shown to the answering model.

## Protocol-specific notes

- `full_problem`: the student answered the whole problem in one response; the
  judge receives the full response with the note: *"The student answered a
  multi-part problem in ONE response. Locate and grade ONLY the part that
  answers the subquestion above; ignore the other subquestions' parts."*

## Retry on malformed output

If the judge output contains no valid JSON object, one follow-up is sent in the
same session: *"Your previous response was not valid JSON or contained no JSON
object. Output ONLY the JSON object now — no markdown fences, no explanation, no
extra text."* A second failure marks the job as a judge error.
