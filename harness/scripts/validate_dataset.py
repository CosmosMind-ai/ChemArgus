#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ChemArgus dataset integrity validator.

Checks:
  1. Partition layout: dev/ test/ private/ each with dataset.jsonl,
     instance_ids.json and tasks/<problem_id>/{problem.json, images/}.
  2. JSON parses; schema keys are complete. dev and private problems carry
     rubrics; test problems must NOT carry rubric / rubric_images.
  3. problem_id format is canonical (Exam-NN-Tn) and subquestion IDs are
     sequential ({problem_id}-1, {problem_id}-2, ...).
  4. Every image referenced by problem.json exists on disk and vice versa
     (no missing references, no orphan files).
  5. No CJK characters or CJK punctuation anywhere in the repository text files.
  6. dataset.jsonl and instance_ids.json are consistent with tasks/.
  7. metadata/sub-id-renumbering-map.json cross-checks against the data.
  8. metadata/split.json (public dev/test lists) matches the partition folders.
     private/ is optional (never published); it is validated when present.

Usage: python validate_dataset.py [repo-root]   (default: repo root = parent of harness/)
Exit code 0 on success, 1 on any finding.
"""
import json
import os
import re
import sys

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")
    except Exception:
        pass

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
if len(sys.argv) > 1:
    REPO = os.path.normpath(sys.argv[1])

PID_RE = re.compile(r"^Exam-\d{2}-T\d+$")
SUB_ID_RE = re.compile(r"^Exam-\d{2}-T\d+-\d+$")
# CJK blocks + CJK punctuation + full-width forms. Built from hex ranges so
# this source file itself contains no CJK characters.
_CJK_RANGES = (
    (0x3000, 0x303F),  # CJK symbols and punctuation
    (0x3400, 0x4DBF),  # CJK extension A
    (0x4E00, 0x9FFF),  # CJK unified ideographs
    (0xF900, 0xFAFF),  # CJK compatibility ideographs
    (0xFF01, 0xFF5E),  # full-width forms
)
CJK = re.compile("[" + "".join("%s-%s" % (chr(a), chr(b)) for a, b in _CJK_RANGES) + "]")
TEXT_EXTS = (".json", ".jsonl", ".md", ".mjs", ".py", ".sh", ".txt", ".gitignore", ".gitattributes")

errors = []
warnings = []


def err(msg):
    errors.append(msg)
    print("ERROR: " + msg)


def warn(msg):
    warnings.append(msg)
    print("WARN:  " + msg)


def walk_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules", "__pycache__")]
        for fn in filenames:
            yield os.path.join(dirpath, fn)


stats = {}
all_pids = {}
for part in ("dev", "test", "private"):
    part_root = os.path.join(REPO, part)
    if not os.path.isdir(part_root):
        if part == "private":
            warn("private/ not present (expected: never published; kept on the evaluation side)")
        else:
            err("%s/ directory missing" % part)
        continue

    tasks_root = os.path.join(part_root, "tasks")
    if not os.path.isdir(tasks_root):
        err("%s/tasks/ directory missing" % part)
        continue

    pids = {}
    stats[part] = {"problems": 0, "subs": 0, "marks": 0, "images": 0}
    for entry in sorted(os.listdir(tasks_root)):
        tdir = os.path.join(tasks_root, entry)
        if not os.path.isdir(tdir):
            err("%s/tasks: unexpected file %s" % (part, entry))
            continue
        pj = os.path.join(tdir, "problem.json")
        if not os.path.isfile(pj):
            err("%s/tasks/%s: missing problem.json" % (part, entry))
            continue
        try:
            with open(pj, encoding="utf-8") as f:
                prob = json.load(f)
        except Exception as e:
            err("%s/tasks/%s/problem.json: %s" % (part, entry, e))
            continue
        if isinstance(prob, list):
            err("%s/tasks/%s/problem.json is wrapped in an array" % (part, entry))
            continue
        pids[entry] = prob
        stats[part]["problems"] += 1
        if prob.get("problem_id") != entry:
            err("%s: problem_id %r does not match directory tasks/%s" % (part, prob.get("problem_id"), entry))

    # ---- schema + IDs ----
    REQUIRED = ("problem_id", "header", "header_images", "subquestions")
    SUB_REQUIRED = ("sub_id", "tags", "text_open", "text_images", "full_mark", "rubric", "rubric_images")
    for pid, prob in pids.items():
        if not PID_RE.match(pid):
            err("%s: problem_id %r does not match canonical format" % pid)
        for key in REQUIRED:
            if key not in prob:
                err("%s/%s: missing top-level key %r" % (part, pid, key))
        for i, sq in enumerate(prob.get("subquestions", [])):
            if part == "test":
                if "rubric" in sq or "rubric_images" in sq:
                    err("%s/test/%s: subquestion %d must NOT carry rubric/rubric_images" % (part, pid, i + 1))
            else:
                for key in ("rubric", "rubric_images"):
                    if key not in sq:
                        err("%s/%s subquestion %d: missing key %r" % (part, pid, i + 1, key))
            for key in ("sub_id", "tags", "text_open", "text_images", "full_mark"):
                if key not in sq:
                    err("%s/%s subquestion %d: missing key %r" % (part, pid, i + 1, key))
            expect = "%s-%d" % (pid, i + 1)
            if sq.get("sub_id") != expect:
                err("%s/%s: sub_id %r should be %r" % (part, pid, sq.get("sub_id"), expect))
            if not isinstance(sq.get("full_mark"), (int, float)) or sq.get("full_mark", 0) <= 0:
                err("%s/%s subquestion %d: bad full_mark %r" % (part, pid, i + 1, sq.get("full_mark")))
            stats[part]["subs"] += 1
            stats[part]["marks"] += sq.get("full_mark", 0)
        for lst_name in ("header_images",):
            for img in prob.get(lst_name, []):
                for key in ("file", "description"):
                    if key not in img:
                        err("%s/%s: header image missing key %r" % (part, pid, key))
        for sq in prob.get("subquestions", []):
            for lst in (sq.get("text_images", []),):
                for img in lst:
                    for key in ("file", "description"):
                        if key not in img:
                            err("%s/%s: image object missing key %r" % (part, pid, key))
            if part != "test":
                for img in sq.get("rubric_images", []):
                    for key in ("file", "description"):
                        if key not in img:
                            err("%s/%s: rubric image object missing key %r" % (part, pid, key))

    # ---- image refs vs disk ----
    for pid, prob in pids.items():
        refs = [img["file"] for img in prob.get("header_images", [])]
        for sq in prob.get("subquestions", []):
            for img in sq.get("text_images", []):
                refs.append(img["file"])
            if part != "test":
                for img in sq.get("rubric_images", []):
                    refs.append(img["file"])
        imgdir = os.path.join(tasks_root, pid, "images")
        if not os.path.isdir(imgdir):
            err("%s/%s: images/ directory missing" % (part, pid))
            continue
        on_disk = set(os.listdir(imgdir))
        refset = set(refs)
        for r in sorted(refset - on_disk):
            err("%s/%s: referenced image missing on disk: %s" % (part, pid, r))
        for f in sorted(on_disk - refset):
            err("%s/%s: orphan image file: %s" % (part, pid, f))
        if len(refs) != len(refset):
            err("%s/%s: duplicate image reference" % (part, pid))
        stats[part]["images"] += len(refset)

    # ---- dataset.jsonl / instance_ids.json consistency ----
    jl_path = os.path.join(part_root, "dataset.jsonl")
    ids_path = os.path.join(part_root, "instance_ids.json")
    if not os.path.isfile(jl_path):
        err("%s/dataset.jsonl missing" % part)
    else:
        with open(jl_path, encoding="utf-8") as f:
            lines = [ln for ln in f.read().splitlines() if ln.strip()]
        jl_ids = []
        for n, ln in enumerate(lines, 1):
            try:
                obj = json.loads(ln)
            except Exception as e:
                err("%s/dataset.jsonl line %d: %s" % (part, n, e))
                continue
            jl_ids.append(obj.get("problem_id"))
        if sorted(jl_ids) != sorted(pids):
            err("%s: dataset.jsonl problem ids do not match tasks/" % part)
        if len(lines) != len(pids):
            err("%s: dataset.jsonl has %d lines but tasks/ has %d problems" % (part, len(lines), len(pids)))
    if not os.path.isfile(ids_path):
        err("%s/instance_ids.json missing" % part)
    else:
        with open(ids_path, encoding="utf-8") as f:
            ids = json.load(f)
        if sorted(ids) != sorted(pids):
            err("%s: instance_ids.json does not match tasks/" % part)

    all_pids.update({pid: part for pid in pids})

# ---- CJK scan over text files ----
for fp in walk_files(REPO):
    if not fp.endswith(TEXT_EXTS):
        continue
    rel = os.path.relpath(fp, REPO)
    try:
        with open(fp, encoding="utf-8") as f:
            txt = f.read()
    except UnicodeDecodeError:
        err("%s: not valid UTF-8" % rel)
        continue
    for m in CJK.finditer(txt):
        err("%s: CJK character at offset %d: ...%s..."
            % (rel, m.start(), txt[max(0, m.start() - 25):m.end() + 25]))

# ---- renumbering map cross-check ----
map_path = os.path.join(REPO, "metadata", "sub-id-renumbering-map.json")
if not os.path.isfile(map_path):
    warn("metadata/sub-id-renumbering-map.json missing")
else:
    with open(map_path, encoding="utf-8") as f:
        mp = json.load(f)
    for e in mp.get("mappings", []):
        pid, pos, new_sid = e.get("problem_id"), e.get("position_in_problem"), e.get("new_sub_id")
        if pid not in all_pids:
            # problem belongs to a partition not present in this copy (e.g. the
            # never-published private set when validating a public clone)
            continue
        part = all_pids[pid]
        actual = json.load(open(os.path.join(REPO, part, "tasks", pid, "problem.json"), encoding="utf-8"))["subquestions"][pos - 1]["sub_id"]
        if actual != new_sid:
            err("map entry %s pos %d: new_sub_id %r but data has %r" % (pid, pos, new_sid, actual))

# ---- split.json cross-check ----
split_path = os.path.join(REPO, "metadata", "split.json")
if not os.path.isfile(split_path):
    warn("metadata/split.json missing")
else:
    with open(split_path, encoding="utf-8") as f:
        sp = json.load(f)
    for part in ("dev", "test"):
        if sorted(sp.get(part, [])) != sorted(pid for pid, a in all_pids.items() if a == part):
            err("metadata/split.json %s list does not match %s/ tasks" % (part, part))

# ---- summary ----
print()
print("=== ChemArgus validation ===")
total = {"problems": 0, "subs": 0, "marks": 0, "images": 0}
for part in ("dev", "test", "private"):
    s = stats.get(part)
    if not s:
        continue
    for k in total:
        total[k] += s[k]
    print("%-8s problems: %3d  subquestions: %3d  marks: %4d  images: %3d"
          % (part + ":", s["problems"], s["subs"], s["marks"], s["images"]))
print("total     problems: %3d  subquestions: %3d  marks: %4d  images: %3d"
      % (total["problems"], total["subs"], total["marks"], total["images"]))
print("errors: %d  warnings: %d" % (len(errors), len(warnings)))
if errors:
    print("RESULT: FAIL")
    sys.exit(1)
print("RESULT: PASS")
