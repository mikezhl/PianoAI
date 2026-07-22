#!/usr/bin/env python3
"""Validate every PianoAI analysis referenced by the score catalog."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from validate_analysis import validate_schema, validate_semantics


SCORE_SUFFIXES = {".mxl", ".musicxml", ".xml"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("data/catalog.json"))
    parser.add_argument("--schema", type=Path, default=Path("schemas/score-analysis.schema.json"))
    parser.add_argument("--library-dir", type=Path, default=Path("data/scores"))
    parser.add_argument("--analysis-dir", type=Path, default=Path("data/analyses"))
    parser.add_argument("--require-complete", action="store_true")
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected a JSON object")
    return value


def safe_child(parent: Path, name: str) -> Path:
    if Path(name).name != name:
        raise ValueError(f"unsafe manifest filename: {name!r}")
    return parent / name


def main() -> int:
    args = parse_args()
    try:
        manifest = read_json(args.manifest)
        schema = read_json(args.schema)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}")
        return 2

    errors: list[str] = []
    expected_schema = schema.get("properties", {}).get("schemaVersion", {}).get("const")
    if manifest.get("schemaVersion") != expected_schema:
        errors.append(f"manifest schemaVersion must be {expected_schema!r}")
    items = manifest.get("items")
    if not isinstance(items, list):
        errors.append("manifest items must be an array")
        items = []

    seen_score_ids: set[str] = set()
    seen_source_files: set[str] = set()
    seen_analysis_files: set[str] = set()
    validated: list[dict[str, Any]] = []

    for index, item in enumerate(items):
        prefix = f"items[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{prefix}: expected an object")
            continue
        score_id = item.get("scoreId")
        title = item.get("title")
        source_hash = item.get("sourceHash")
        if not all(isinstance(value, str) and value for value in (score_id, title, source_hash)):
            errors.append(f"{prefix}: missing scoreId, title, or sourceHash")
            continue
        source_file = f"{score_id}.mxl"
        analysis_file = f"{score_id}.json"
        for value, seen, field in (
            (score_id, seen_score_ids, "scoreId"),
            (source_file, seen_source_files, "score file"),
            (analysis_file, seen_analysis_files, "analysis file"),
        ):
            if value in seen:
                errors.append(f"{prefix}.{field}: duplicate {value!r}")
            seen.add(value)

        try:
            source_path = safe_child(args.library_dir, source_file)
            analysis_path = safe_child(args.analysis_dir, analysis_file)
            analysis = read_json(analysis_path)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            errors.append(f"{prefix}: {error}")
            continue

        item_errors: list[str] = []
        validate_schema(analysis, schema, schema, "$", item_errors)
        if not item_errors:
            validate_semantics(analysis, source_path, item_errors)
        score = analysis.get("score", {})
        if score.get("id") != score_id:
            item_errors.append(f"$.score.id: expected {score_id!r}")
        if score.get("sourceFile") != source_file:
            item_errors.append(f"$.score.sourceFile: expected {source_file!r}")
        if score.get("sourceHash") != source_hash:
            item_errors.append("$.score.sourceHash: does not match manifest")
        if score.get("title") != title:
            item_errors.append(f"$.score.title: expected {title!r}")
        if item_errors:
            errors.extend(f"{analysis_file}: {error}" for error in item_errors)
            continue
        validated.append({
            "scoreId": score_id,
            "sections": len(analysis["sections"]),
            "motifFamilies": len(analysis["motifFamilies"]),
            "leftHandAnalysisMode": analysis["leftHandAnalysisMode"],
            "leftHandChordGrouping": (
                analysis["leftHandChordGrouping"]["defaultMode"]
                if analysis["leftHandChordGrouping"] is not None
                else None
            ),
            "leftHandChordFamilies": len(analysis["leftHandChordFamilies"]),
            "leftHandTextureFamilies": len(analysis["leftHandTextureFamilies"]),
        })

    if args.require_complete and not args.library_dir.is_dir():
        errors.append(f"library directory does not exist: {args.library_dir}")
    elif args.require_complete:
        library_files = {
            path.name for path in args.library_dir.iterdir()
            if path.is_file() and path.suffix.lower() in SCORE_SUFFIXES
        }
        missing = sorted(library_files - seen_source_files)
        extra = sorted(seen_source_files - library_files)
        if missing:
            errors.append(f"manifest is missing library scores: {missing}")
        if extra:
            errors.append(f"manifest references non-library scores: {extra}")

    if errors:
        print(f"Manifest validation failed with {len(errors)} error(s):")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"Manifest validation passed: {args.manifest}")
    print(json.dumps(validated, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
