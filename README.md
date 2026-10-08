---
task_categories:
- question-answering
language:
- en
tags:
- chemistry
- multimodal
- competition-level
- evaluation
- benchmark
pretty_name: ChemArgus
size_categories:
- n<1K
configs:
- config_name: dev
  data_files:
  - split: dev
    path: dev/dataset.jsonl
- config_name: test
  data_files:
  - split: test
    path: test/dataset.jsonl
---

# ChemArgus

ChemArgus is a competition-level, multimodal, diagnostic benchmark for expert
chemistry reasoning. Problems are drawn from chemistry competition material,
textbooks, and research papers, and are scored by fine-grained rubrics with
partial credit rather than by answer endpoints.

Chemistry evaluation has moved past multiple-choice probes toward open-ended
expert problems, yet the benchmarks that define the current frontier still score
answer endpoints alone. Such scoring conflates memorized facts with stepwise
derivation, treats visual and textual inputs as interchangeable, and confounds
long-horizon planning with stepwise execution. ChemArgus replaces the answer
endpoint with three measurement properties:

- **Fine-grained scoring** grades every subquestion point by point with partial
  credit, so a score lands at the level of the step rather than the outcome.
- **Multimodal capability** is priced on every problem containing a real image,
  paired with a controlled text description, so visual understanding is measured
  against text on identical tasks.
- **Diagnostic attribution** reads paired metrics that share one scoring unit and
  differ only in context construction, so a gap between two scores isolates a
  single cause: integration, propagation, or local reasoning.

Reference scores, model results, and traces are intentionally excluded from this
release.

## Dataset partitions

The 191 problems (23 exams) are divided into three partitions. All three
partitions are drawn by seeded stratified sampling so that the distribution of
**level** (exam series), **subfield** (major knowledge category), and
**modality** (with / without model-visible images) is consistent across
partitions and matches the full set.

| Partition | Share | Problems | Subquestions | Marks | Content |
| --- | ---: | ---: | ---: | ---: | --- |
| `dev/` — Public Dev Set | 25% | 48 | 210 | 636 | problems **with** rubrics, for debugging |
| `test/` — Held-out Test Set | 55% | 105 | 445 | 1387 | problems **without** rubrics; graded by the evaluation side |
| `private/` — Private Set | 20% | 38 | 165 | 559 | never published (anti-cheating final check) |

`private/` is not part of this repository. The evaluation side keeps it
separately; `test/` submissions are scored against the held-out rubrics there.

`metadata/split.json` records the dev/test assignment (the private list is
never published).

## Layout

```
dev/
  dataset.jsonl              one JSON object per dev problem (with rubrics)
  instance_ids.json          the 48 dev problem ids
  tasks/<problem_id>/
    problem.json             full problem: prompt + rubric + image metadata
    images/*.png
test/
  dataset.jsonl              one JSON object per test problem (rubrics stripped)
  instance_ids.json          the 105 test problem ids
  tasks/<problem_id>/
    problem.json             problem prompt; rubric fields absent
    images/*.png
metadata/
  sub-id-renumbering-map.json
  split.json                 public partition assignment (dev/test)
harness/
  prompts/judge_rubric.md    judge prompt specification
  scripts/                   evaluation pipeline (Pi SDK based)
```

## Data format

Each problem is a JSON object:

```json
{
  "problem_id": "Exam-01-T10",
  "header": "Light",
  "header_images": [
    {"file": "Exam-01-T10-header-1.png", "description": "..."}
  ],
  "subquestions": [
    {
      "sub_id": "Exam-01-T10-1",
      "tags": ["2.2", "2.4"],
      "text_open": "10-1 Light can excite certain chemical bonds. ...",
      "text_images": [
        {"file": "Exam-01-T10-1-1-prompt.png", "description": "..."}
      ],
      "full_mark": 8,
      "rubric": ["[C]: ... (4 points)", "D: ... (4 points)"],
      "rubric_images": [
        {"file": "Exam-01-T10-1-1-rubric.png", "description": "..."}
      ]
    }
  ]
}
```

- `problem_id`: `Exam-<nn>-T<task>` (`nn` is the 01-23 exam index);
  `sub_id`: `{problem_id}-{n}` (sequential).
- `header` is the shared background of the whole problem.
- `text_open` is the subquestion text; `full_mark` is the integer maximum score.
- In `dev/` problems, `rubric` lists the scoring points with partial-credit
  annotations and `rubric_images` are the private scoring figures.
  In `test/` problems the `rubric` and `rubric_images` fields are **absent**.
- Image files use the unified naming scheme
  `{problem_id}-{sub_index}-{n}-prompt|rubric.png` (subquestion images) and
  `{problem_id}-header-{n}.png` (problem-level images).

### Image visibility

- `header_images` and `text_images` are **model-visible**.
- `rubric_images` are **private scoring images**: they are only given to the
  judge, never to the answering model.

## Evaluation protocols

Three protocols share one scoring unit and differ only in context construction:

- **`full_problem`** — the model receives the complete problem (header, images,
  all subquestions) in one call and answers everything in one response.
- **`sequential_carry`** — the model answers subquestions in order; each answer
  is carried into the next step, with no access to gold answers or rubrics.
- **`oracle_scaffolded`** — the model answers each subquestion after being given
  the correct result of the previous one; it isolates local reasoning from
  error propagation.

## Scoring

The core metric is the **Normalized Rubric Score**: the rubric-grounded points
awarded divided by the problem's total marks. Every subquestion is graded by an
LLM judge against the private rubric (partial credit per scoring point), with
structure/SMILES equivalence handled by chemical meaning. The judge prompt is
specified in `harness/prompts/judge_rubric.md`.

## Running the evaluation

The harness uses the [Pi coding agent SDK](https://www.npmjs.com/package/@earendil-works/pi-coding-agent):

```bash
cd harness/scripts
npm install @earendil-works/pi-coding-agent   # or set PI_SDK_ENTRY to its dist/index.js

# run all three protocols for one problem
node run_problem.mjs ../../dev/tasks/Exam-01-T10/problem.json ./runs/Exam-01-T10

# batch run all problems of a partition, then grade
node run_all.mjs ../../dev/tasks ./runs 3
node grade_all.mjs ../../dev/tasks ./runs 3
node summarize.mjs ../../dev/tasks ./runs ./runs/results.md
```

Provider/model are configured via environment variables (`PI_PROVIDER`,
`PI_MODEL_ID`, `PI_JUDGE_MODEL_ID`, `PI_THINKING_LEVEL`, `PI_INPUT_MODE`).

Validate the dataset at any time:

```bash
python harness/scripts/validate_dataset.py
```

## Leaderboard

Live results: <https://www.cosmosmind.ai/leaderboard/chemargus>

## Citation

```bibtex
@misc{chemargus2026,
  title  = {ChemArgus: From Answer Accuracy to Rubric-Grounded Reasoning
            Diagnosis in Multimodal Expert-Level Chemistry Benchmark},
  author = {Hanyu Guo and Mo Cui and Zihan Tan and Leixin Sun and Yichun Wang and
            Yinan Shen and Guojun Zhu and Jia Jiang and Yichen Fan and Zui Chen and
            Wenzhe Gao and Zhihao Yu and Qijun Wang and Yetian Zhu and Jiande Chen and
            Chuhang Pei and Yao Jiang and Erhao Chen and Pinhan Wang and Xiaorui Pan and
            Qianyi Zhu and Yang Liu and Mang Ye and Guancheng Wan},
  year   = {2026}
}
```
