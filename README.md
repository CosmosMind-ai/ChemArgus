---
license: other
task_categories:
- question-answering
language:
- en
pretty_name: ChemArgus
size_categories:
- n<1K
tags:
- chemistry
- multimodal
- competition-level
- evaluation
- benchmark
annotations_creators:
- expert-generated
language_creators:
- found
multilinguality:
- monolingual
viewer: true
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

<div align="center">

# 🔬 ChemArgus

### From Answer Accuracy to Rubric-Grounded Reasoning Diagnosis<br>in Multimodal Expert-Level Chemistry

![dev](https://img.shields.io/badge/dev-48%20with%20rubrics-brightgreen)
![test](https://img.shields.io/badge/test-105%20held--out-orange)
![private](https://img.shields.io/badge/private-38%20never%20published-lightgrey)
![multimodal](https://img.shields.io/badge/input-multimodal%20%2B%20text-blueviolet)
![language](https://img.shields.io/badge/language-en-blue)

</div>

---

**ChemArgus** is a competition-level, multimodal, diagnostic benchmark for expert
chemistry reasoning. Problems are drawn from chemistry competition material,
textbooks, and research papers — and scored by fine-grained rubrics with partial
credit, instead of answer endpoints.

> Chemistry evaluation has moved past multiple-choice probes toward open-ended
> expert problems, yet current frontier benchmarks still score answer endpoints
> alone. Such scoring conflates memorized facts with stepwise derivation, treats
> visual and textual inputs as interchangeable, and confounds long-horizon
> planning with stepwise execution. ChemArgus replaces the answer endpoint with
> three measurement properties:
>
> - **Fine-grained scoring** — every subquestion is graded point by point with
>   partial credit, so a score lands at the level of the step.
> - **Multimodal capability** — every problem with a real image is paired with a
>   controlled text description, pricing visual understanding against text.
> - **Diagnostic attribution** — paired metrics share one scoring unit and differ
>   only in context construction, isolating integration, propagation, or local
>   reasoning as the cause of a score gap.

---

## 📊 Dataset Partitions

| | Share | Problems | Subquestions | Marks | Public images | Rubrics |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 🧪 **dev** · Public Dev Set | 25% | 48 | 210 | 636 | 268 | ✅ included |
| 🏁 **test** · Held-out Test Set | 55% | 105 | 445 | 1387 | 268 | ❌ stripped |
| 🔒 **private** · Private Set | 20% | 38 | 165 | 559 | — | 🔐 local only |
| **Total** | 100% | **191** | **820** | **2582** | **536** | |

> 🎲 **Seeded stratified split** — the distribution of *level* (exam series),
> *subfield* (knowledge category), and *modality* (with / without model-visible
> images) stays consistent across all three partitions and matches the full set
> (max deviation ≈ 3 percentage points).

## 📁 Repository Layout

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
```

## 🧬 Data Format

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

| Field | Meaning |
| --- | --- |
| `problem_id` | `Exam-<nn>-T<task>` — `nn` is the 01–23 exam index |
| `sub_id` | `{problem_id}-{n}` (sequential within the problem) |
| `header` | Shared background of the whole problem |
| `text_open` | Subquestion text |
| `full_mark` | Integer maximum score of the subquestion |
| `rubric` | Scoring points with partial-credit annotations — **absent in `test/`** |
| `*_images[].file` | Image file name (see naming scheme below) |
| `*_images[].description` | Text description of the image content |

Image files follow a unified naming scheme:
`{problem_id}-{sub_index}-{n}-prompt|rubric.png` (subquestion images) and
`{problem_id}-header-{n}.png` (problem-level images).

> ⚠️ **Image visibility** — `header_images` and `text_images` are
> **model-visible**; `rubric_images` are **private scoring images**, given only
> to the judge, never to the answering model. They do not appear in `test/` at all.

## 🔀 Evaluation Protocols

Three protocols share one scoring unit and differ only in context construction:

1. **`full_problem`** — the model receives the complete problem in one call and
   answers everything in one response.
2. **`sequential_carry`** — subquestions are answered in order; each answer is
   carried into the next step, with no access to gold answers.
3. **`oracle_scaffolded`** — each subquestion is answered after being given the
   correct result of the previous one; isolates local reasoning from error
   propagation.

## ⚖️ Scoring

The core metric is the **Normalized Rubric Score**: rubric-grounded points
awarded divided by the problem's total marks. Every subquestion is graded by an
LLM judge against the private rubric (partial credit per scoring point), with
structure/SMILES equivalence judged by chemical meaning.

## 🏆 Leaderboard

Live results: <https://www.cosmosmind.ai/leaderboard/chemargus>

## 📖 Citation

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
