# 🔬 ChemArgus

### From Answer Accuracy to Rubric-Grounded Reasoning Diagnosis<br>in Multimodal Expert-Level Chemistry

![dev](https://img.shields.io/badge/dev-48%20with%20rubrics-brightgreen)
![test](https://img.shields.io/badge/test-105%20held--out-orange)
![private](https://img.shields.io/badge/private-38%20never%20published-lightgrey)
![multimodal](https://img.shields.io/badge/input-multimodal%20%2B%20text-blueviolet)
![language](https://img.shields.io/badge/language-en-blue)

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

## 🏅 Results & Leaderboard

*Snapshot: September 2026 · Normalized Rubric Score (%). Runs are sorted by
`full_problem` within each input mode.*

🥇 **`full_problem` leaders** — Multimodal: Claude Opus 5 53.8%† ·
Text: Claude Opus 5 61.5%† · Text + reader: GLM-5.2 52.0%

| Model | Input | full_problem | sequential_carry | oracle_scaffolded |
| --- | --- | ---: | ---: | ---: |
| Claude Opus 5 † | multimodal | 53.8 | 59.4 | 64.9 |
| Gemini 3.8 Flash § | multimodal | 48.5 | 58.5 | 60.3 |
| Grok 4.6 § | multimodal | 33.8 | 41.8 | 45.5 |
| Qwen3.8-Max | multimodal | 29.3 | 31.2 | 34.0 |
| Kimi K3 | multimodal | 27.5 | 30.6 | 31.8 |
| MiniMax M3 | multimodal | 27.3 | 27.5 | 27.9 |
| GPT-5.6-Sol | multimodal | 23.2 | 28.8 | 30.4 |
| Claude Opus 5 † | text | 61.5 | 61.7 | 61.7 |
| Gemini 3.8 Flash § | text | 46.5 | 59.0 | 59.7 |
| Qwen3.8-Max | text | 36.0 | 39.0 | 41.9 |
| Kimi K3 | text | 34.5 | 36.0 | 37.5 |
| Grok 4.6 § | text | 33.4 | 42.0 | 46.0 |
| GPT-5.6-Sol | text | 29.8 | 35.6 | 36.5 |
| MiniMax M3 | text | 26.2 | 28.7 | 29.1 |
| DeepSeek V4 Pro | text | 25.0 | 25.0 | 27.6 |
| GLM-5.2 | text | 23.5 | 24.9 | 25.1 |
| GLM-5.2 | text + reader | 52.0 | 52.2 | 52.4 |
| Claude Opus 5 † | text + reader | 46.2 | 53.9 | 54.7 |
| DeepSeek V4 Pro | text + reader | 36.7 | 36.8 | 37.0 |
| Gemini 3.8 Flash § | text + reader | 33.8 | 45.1 | 49.7 |
| Kimi K3 | text + reader | 32.3 | 32.3 | 32.4 |
| GPT-5.6-Sol | text + reader | 31.1 | 33.6 | 34.0 |
| Grok 4.6 § | text + reader | 28.6 | 29.0 | 31.1 |
| Qwen3.8-Max | text + reader | 27.9 | 29.2 | 31.5 |
| MiniMax M3 | text + reader | 27.2 | 27.3 | 27.3 |

> † Claude Opus 5 runs rest on a small problem prefix (39–103 points) and are
> provisional until the full set completes.
> § Gemini 3.8 Flash and Grok 4.6 runs sit on a 12-paper, 1136-point subset.
> Percentages are computed on each run's own scored problem set, so
> denominators differ across runs.

Live leaderboard: <https://www.cosmosmind.ai/leaderboard/chemargus>

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
