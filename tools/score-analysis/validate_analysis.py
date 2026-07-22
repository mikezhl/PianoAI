#!/usr/bin/env python3
"""Validate PianoAI score-analysis JSON without third-party dependencies."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from fractions import Fraction
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

from inspect_score import extract as inspect_source_score


JsonValue = Any


def path_child(path: str, key: str | int) -> str:
    if isinstance(key, int):
        return f"{path}[{key}]"
    return f"{path}.{key}"


def resolve_ref(root: dict[str, Any], ref: str) -> JsonValue:
    if not ref.startswith("#/"):
        raise ValueError(f"Only local JSON Schema refs are supported: {ref}")
    value: JsonValue = root
    for token in ref[2:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        value = value[token]
    return value


def allowed_properties(schema: JsonValue, root: dict[str, Any], seen: set[int] | None = None) -> set[str]:
    if schema is True or schema is False or not isinstance(schema, dict):
        return set()
    seen = seen or set()
    marker = id(schema)
    if marker in seen:
        return set()
    seen.add(marker)

    result = set(schema.get("properties", {}).keys())
    if "$ref" in schema:
        result.update(allowed_properties(resolve_ref(root, schema["$ref"]), root, seen))
    for part in schema.get("allOf", []):
        result.update(allowed_properties(part, root, seen))
    return result


def type_matches(value: JsonValue, expected: str | list[str]) -> bool:
    if isinstance(expected, list):
        return any(type_matches(value, candidate) for candidate in expected)
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    return True


def validate_schema(
    value: JsonValue,
    schema: JsonValue,
    root: dict[str, Any],
    path: str,
    errors: list[str],
) -> None:
    if schema is True:
        return
    if schema is False:
        errors.append(f"{path}: value is forbidden by the Schema")
        return
    if not isinstance(schema, dict):
        errors.append(f"{path}: invalid validator schema node")
        return

    if "$ref" in schema:
        validate_schema(value, resolve_ref(root, schema["$ref"]), root, path, errors)

    if "anyOf" in schema:
        branch_errors: list[list[str]] = []
        for branch in schema["anyOf"]:
            candidate_errors: list[str] = []
            validate_schema(value, branch, root, path, candidate_errors)
            if not candidate_errors:
                break
            branch_errors.append(candidate_errors)
        else:
            errors.append(f"{path}: value does not match any allowed Schema branch")
        return

    for part in schema.get("allOf", []):
        validate_schema(value, part, root, path, errors)

    if "const" in schema and value != schema["const"]:
        errors.append(f"{path}: expected constant {schema['const']!r}, got {value!r}")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: {value!r} is not one of {schema['enum']!r}")

    expected_type = schema.get("type")
    if expected_type and not type_matches(value, expected_type):
        errors.append(f"{path}: expected {expected_type}, got {type(value).__name__}")
        return

    if isinstance(value, dict):
        required = schema.get("required", [])
        for key in required:
            if key not in value:
                errors.append(f"{path}: missing required property {key!r}")

        properties = schema.get("properties", {})
        for key, child_schema in properties.items():
            if key in value:
                validate_schema(value[key], child_schema, root, path_child(path, key), errors)

        if schema.get("additionalProperties") is False:
            for key in sorted(set(value) - set(properties)):
                errors.append(f"{path}: unexpected property {key!r}")

        if schema.get("unevaluatedProperties") is False:
            allowed = allowed_properties(schema, root)
            for key in sorted(set(value) - allowed):
                errors.append(f"{path}: unexpected property {key!r}")

    if isinstance(value, list):
        minimum = schema.get("minItems")
        if minimum is not None and len(value) < minimum:
            errors.append(f"{path}: expected at least {minimum} items, got {len(value)}")
        if "items" in schema:
            for index, item in enumerate(value):
                validate_schema(item, schema["items"], root, path_child(path, index), errors)

    if isinstance(value, str):
        minimum = schema.get("minLength")
        if minimum is not None and len(value) < minimum:
            errors.append(f"{path}: expected at least {minimum} characters")
        pattern = schema.get("pattern")
        if pattern and re.fullmatch(pattern, value) is None:
            errors.append(f"{path}: {value!r} does not match {pattern!r}")
        if schema.get("format") == "uri" and not urlparse(value).scheme:
            errors.append(f"{path}: {value!r} is not an absolute URI")

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        minimum = schema.get("minimum")
        if minimum is not None and value < minimum:
            errors.append(f"{path}: expected value >= {minimum}, got {value}")


def position_key(position: dict[str, Any]) -> tuple[int, Fraction]:
    offset = position["offsetQuarter"]
    return (
        position["measureIndex"],
        Fraction(offset["numerator"], offset["denominator"]),
    )


def iter_ranges(data: dict[str, Any]) -> Iterable[tuple[str, dict[str, Any]]]:
    single_range_collections = ["sections"]
    for collection in single_range_collections:
        for index, item in enumerate(data.get(collection, [])):
            yield f"$.{collection}[{index}].range", item["range"]

    for family_index, family in enumerate(data.get("motifFamilies", [])):
        for occurrence_index, occurrence in enumerate(family.get("occurrences", [])):
            yield (
                f"$.motifFamilies[{family_index}].occurrences[{occurrence_index}].range",
                occurrence["range"],
            )

    for family_index, family in enumerate(data.get("leftHandChordFamilies", [])):
        for occurrence_index, occurrence in enumerate(family.get("occurrences", [])):
            yield (
                f"$.leftHandChordFamilies[{family_index}].occurrences[{occurrence_index}].range",
                occurrence["range"],
            )

    for family_index, family in enumerate(data.get("leftHandTextureFamilies", [])):
        for occurrence_index, occurrence in enumerate(family.get("occurrences", [])):
            yield (
                f"$.leftHandTextureFamilies[{family_index}].occurrences[{occurrence_index}].range",
                occurrence["range"],
            )


def validate_range(
    path: str,
    score_range: dict[str, Any],
    internal_measure_count: int,
    errors: list[str],
) -> None:
    start = score_range["start"]
    end = score_range["end"]
    start_index = start["measureIndex"]
    end_index = end["measureIndex"]

    if not 0 <= start_index < internal_measure_count:
        errors.append(f"{path}.start.measureIndex: outside 0..{internal_measure_count - 1}")
    if not 0 <= end_index <= internal_measure_count:
        errors.append(f"{path}.end.measureIndex: outside 0..{internal_measure_count}")
    if end_index == internal_measure_count and position_key(end)[1] != 0:
        errors.append(f"{path}.end: terminal sentinel must use zero offset")
    if position_key(start) >= position_key(end):
        errors.append(f"{path}: range must be non-empty and ordered")


def collect_ids(data: dict[str, Any], errors: list[str]) -> tuple[set[str], set[str]]:
    seen: dict[str, str] = {}
    source_ids: set[str] = set()
    motif_ids: set[str] = set()

    def add(identifier: str, path: str) -> None:
        previous = seen.get(identifier)
        if previous:
            errors.append(f"{path}: duplicate id {identifier!r}; first used at {previous}")
        else:
            seen[identifier] = path

    for collection in [
        "sources",
        "crossValidation",
        "sections",
    ]:
        for index, item in enumerate(data.get(collection, [])):
            add(item["id"], f"$.{collection}[{index}].id")
            if collection == "sources":
                source_ids.add(item["id"])

    for family_index, family in enumerate(data.get("motifFamilies", [])):
        add(family["id"], f"$.motifFamilies[{family_index}].id")
        motif_ids.add(family["id"])
        for occurrence_index, occurrence in enumerate(family.get("occurrences", [])):
            add(
                occurrence["id"],
                f"$.motifFamilies[{family_index}].occurrences[{occurrence_index}].id",
            )

    for family_index, family in enumerate(data.get("leftHandChordFamilies", [])):
        add(family["id"], f"$.leftHandChordFamilies[{family_index}].id")
        for occurrence_index, occurrence in enumerate(family.get("occurrences", [])):
            add(
                occurrence["id"],
                f"$.leftHandChordFamilies[{family_index}].occurrences[{occurrence_index}].id",
            )

    for family_index, family in enumerate(data.get("leftHandTextureFamilies", [])):
        add(family["id"], f"$.leftHandTextureFamilies[{family_index}].id")
        for occurrence_index, occurrence in enumerate(family.get("occurrences", [])):
            add(
                occurrence["id"],
                f"$.leftHandTextureFamilies[{family_index}].occurrences[{occurrence_index}].id",
            )

    return source_ids, motif_ids


def validate_references(
    data: dict[str, Any],
    source_ids: set[str],
    motif_ids: set[str],
    errors: list[str],
) -> None:
    def walk(value: JsonValue, path: str) -> None:
        if isinstance(value, dict):
            for index, source_ref in enumerate(value.get("sourceRefs", [])):
                source_id = source_ref["sourceId"]
                if source_id not in source_ids:
                    errors.append(f"{path}.sourceRefs[{index}].sourceId: unknown source {source_id!r}")
            for key, child in value.items():
                walk(child, path_child(path, key))
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, path_child(path, index))

    walk(data, "$")

    for index, item in enumerate(data.get("crossValidation", [])):
        for source_index, source_id in enumerate(item.get("sourceIds", [])):
            if source_id not in source_ids:
                errors.append(
                    f"$.crossValidation[{index}].sourceIds[{source_index}]: unknown source {source_id!r}"
                )

    for section_index, section in enumerate(data.get("sections", [])):
        for motif_index, motif_id in enumerate(section.get("relatedMotifFamilyIds", [])):
            if motif_id not in motif_ids:
                errors.append(
                    f"$.sections[{section_index}].relatedMotifFamilyIds[{motif_index}]: "
                    f"unknown motif family {motif_id!r}"
                )

    for family_index, family in enumerate(data.get("motifFamilies", [])):
        family_path = f"$.motifFamilies[{family_index}]"
        occurrences = family.get("occurrences", [])
        representative_count = sum(
            occurrence.get("relation") == "representative" for occurrence in occurrences
        )
        if representative_count != 1:
            errors.append(f"{family_path}.occurrences: expected exactly one representative")
        previous_start: tuple[int, Fraction] | None = None
        for occurrence_index, occurrence in enumerate(occurrences):
            occurrence_path = f"{family_path}.occurrences[{occurrence_index}]"
            start = position_key(occurrence["range"]["start"])
            if previous_start is not None and start < previous_start:
                errors.append(f"{occurrence_path}.range.start: occurrences must be ordered")
            previous_start = start

    for family_index, family in enumerate(data.get("leftHandChordFamilies", [])):
        family_path = f"$.leftHandChordFamilies[{family_index}]"
        occurrences = family.get("occurrences", [])
        if family.get("occurrenceCount") != len(occurrences):
            errors.append(
                f"{family_path}.occurrenceCount: "
                f"must equal occurrences length {len(occurrences)}"
            )
        voicing_count = len({occurrence["voicingSignature"] for occurrence in occurrences})
        if family.get("voicingVariantCount") != voicing_count:
            errors.append(
                f"{family_path}.voicingVariantCount: must equal distinct voicing count {voicing_count}"
            )
        expected_bass_counts = Counter(occurrence["bass"] for occurrence in occurrences)
        actual_bass_counts = Counter({
            variant["bass"]: variant["count"] for variant in family.get("bassVariants", [])
        })
        if actual_bass_counts != expected_bass_counts:
            errors.append(
                f"{family_path}.bassVariants: must match occurrence bass counts "
                f"{dict(expected_bass_counts)!r}"
            )
        representative_count = sum(
            occurrence.get("relation") == "representative" for occurrence in occurrences
        )
        if representative_count != 1:
            errors.append(f"{family_path}.occurrences: expected exactly one representative")
        representative = next(
            (occurrence for occurrence in occurrences if occurrence.get("relation") == "representative"),
            None,
        )
        family_pitch_signature = occurrences[0].get("pitchClassSignature") if occurrences else None
        previous_start_tick: int | None = None
        for occurrence_index, occurrence in enumerate(occurrences):
            occurrence_path = f"{family_path}.occurrences[{occurrence_index}]"
            if occurrence.get("absoluteStartTick", 0) >= occurrence.get("absoluteEndTick", 0):
                errors.append(
                    f"{occurrence_path}: "
                    "absolute tick range must be non-empty"
                )
            if occurrence.get("pitchClasses") != family.get("pitchClasses"):
                errors.append(f"{occurrence_path}.pitchClasses: must match family pitchClasses")
            if occurrence.get("pitchClassSignature") != family_pitch_signature:
                errors.append(
                    f"{occurrence_path}.pitchClassSignature: must match the family pitch-class signature"
                )
            if occurrence.get("measureIndex") != occurrence["range"]["start"]["measureIndex"]:
                errors.append(f"{occurrence_path}.measureIndex: must match range start measure")
            if representative is not None and occurrence is not representative:
                relation = occurrence.get("relation")
                same_voicing = occurrence.get("voicingSignature") == representative.get("voicingSignature")
                same_bass = occurrence.get("bass") == representative.get("bass")
                if relation == "exact-voicing" and not same_voicing:
                    errors.append(f"{occurrence_path}.relation: exact-voicing requires the representative voicing")
                if relation == "voicing-variant" and (same_voicing or not same_bass):
                    errors.append(
                        f"{occurrence_path}.relation: voicing-variant requires a changed voicing with the same bass"
                    )
                if relation == "inversion" and same_bass:
                    errors.append(f"{occurrence_path}.relation: inversion requires a different bass")
            start_tick = occurrence.get("absoluteStartTick", 0)
            if previous_start_tick is not None and start_tick < previous_start_tick:
                errors.append(f"{occurrence_path}.absoluteStartTick: occurrences must be ordered")
            previous_start_tick = start_tick

    for family_index, family in enumerate(data.get("leftHandTextureFamilies", [])):
        family_path = f"$.leftHandTextureFamilies[{family_index}]"
        occurrences = family.get("occurrences", [])
        representative_count = sum(
            occurrence.get("relation") == "representative" for occurrence in occurrences
        )
        if representative_count != 1:
            errors.append(f"{family_path}.occurrences: expected exactly one representative")
        previous_start: tuple[int, Fraction] | None = None
        for occurrence_index, occurrence in enumerate(occurrences):
            occurrence_path = f"{family_path}.occurrences[{occurrence_index}]"
            start = position_key(occurrence["range"]["start"])
            if previous_start is not None and start < previous_start:
                errors.append(f"{occurrence_path}.range.start: occurrences must be ordered")
            previous_start = start


def validate_semantics(data: dict[str, Any], source_path: Path | None, errors: list[str]) -> None:
    score = data["score"]
    internal_measure_count = score["internalMeasureCount"]
    measure_numbers = score["measureNumberByIndex"]

    left_hand_mode = data["leftHandAnalysisMode"]
    chord_grouping = data["leftHandChordGrouping"]
    chord_families = data["leftHandChordFamilies"]
    texture_families = data["leftHandTextureFamilies"]
    if left_hand_mode == "chord-groups":
        if chord_grouping is None:
            errors.append("$.leftHandChordGrouping: chord-groups mode requires a grouping configuration")
        if not chord_families:
            errors.append("$.leftHandChordFamilies: chord-groups mode requires generated families")
        if texture_families:
            errors.append("$.leftHandTextureFamilies: chord-groups mode must not contain texture families")
    else:
        if chord_grouping is not None:
            errors.append("$.leftHandChordGrouping: polyphonic-texture mode must not use chord grouping")
        if chord_families:
            errors.append("$.leftHandChordFamilies: polyphonic-texture mode must not contain chord families")
        if not texture_families:
            errors.append("$.leftHandTextureFamilies: polyphonic-texture mode requires texture families")

    previous_override_end = 0
    for index, override in enumerate((chord_grouping or {}).get("overrides", [])):
        path = f"$.leftHandChordGrouping.overrides[{index}]"
        start = override["startMeasureIndex"]
        end = override["endMeasureIndex"]
        if start >= end:
            errors.append(f"{path}: startMeasureIndex must be less than endMeasureIndex")
        if end > internal_measure_count:
            errors.append(f"{path}.endMeasureIndex: outside 1..{internal_measure_count}")
        if start < previous_override_end:
            errors.append(f"{path}: overrides must be ordered and non-overlapping")
        previous_override_end = max(previous_override_end, end)

    if len(measure_numbers) != internal_measure_count:
        errors.append(
            "$.score.measureNumberByIndex: length must equal internalMeasureCount "
            f"({len(measure_numbers)} != {internal_measure_count})"
        )
    pickup_measure_index = score["pickupMeasureIndex"]
    if pickup_measure_index is not None and pickup_measure_index >= internal_measure_count:
        errors.append("$.score.pickupMeasureIndex: outside the internal measure map")
    if score["measureCount"] > internal_measure_count:
        errors.append("$.score.measureCount: cannot exceed internalMeasureCount")

    for path, score_range in iter_ranges(data):
        validate_range(path, score_range, internal_measure_count, errors)

    sections = data.get("sections", [])
    previous_end: tuple[int, Fraction] | None = None
    for index, section in enumerate(sections):
        start = position_key(section["range"]["start"])
        end = position_key(section["range"]["end"])
        if index == 0 and start != (0, Fraction(0)):
            errors.append("$.sections[0].range: section map must start at internal measure 0 offset 0")
        if previous_end is not None and start != previous_end:
            relation = "overlap" if start < previous_end else "gap"
            errors.append(f"$.sections[{index}].range: section map has a {relation}")
        previous_end = end
    terminal = (internal_measure_count, Fraction(0))
    if previous_end != terminal:
        errors.append(
            "$.sections: section map must end at the zero-offset internalMeasureCount sentinel"
        )

    source_ids, motif_ids = collect_ids(data, errors)
    validate_references(data, source_ids, motif_ids, errors)

    if source_path is not None:
        if source_path.name != score["sourceFile"]:
            errors.append(
                f"$.score.sourceFile: expected {source_path.name!r} for supplied source, "
                f"got {score['sourceFile']!r}"
            )
        try:
            source_bytes = source_path.read_bytes()
        except OSError as error:
            errors.append(f"source file cannot be read: {error}")
            return
        digest = hashlib.sha256(source_bytes).hexdigest().upper()
        expected_hash = f"sha256:{digest}"
        if score["sourceHash"] != expected_hash:
            errors.append(
                f"$.score.sourceHash: source hash mismatch; expected {expected_hash}, "
                f"got {score['sourceHash']}"
            )
        try:
            source_facts = inspect_source_score(source_path)
        except (OSError, ValueError, KeyError) as error:
            errors.append(f"source score cannot be inspected: {error}")
            return
        source_checks = {
            "internalMeasureCount": source_facts["internalMeasureCount"],
            "measureCount": source_facts["displayMeasureCount"],
            "pickupMeasureIndex": source_facts["pickupMeasureIndex"],
            "measureNumberByIndex": source_facts["measureNumberByIndex"],
            "meter": source_facts["openingMeter"],
        }
        for field, expected in source_checks.items():
            if score[field] != expected:
                errors.append(
                    f"$.score.{field}: source score reports {expected!r}, got {score[field]!r}"
                )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("analysis", type=Path, help="Analysis JSON file")
    parser.add_argument(
        "--schema",
        type=Path,
        default=Path("schemas/score-analysis.schema.json"),
        help="Schema file (default: schemas/score-analysis.schema.json)",
    )
    parser.add_argument("--source", type=Path, help="Optional MusicXML/MXL source for filename and SHA-256 checks")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        data = json.loads(args.analysis.read_text(encoding="utf-8"))
        schema = json.loads(args.schema.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2

    errors: list[str] = []
    validate_schema(data, schema, schema, "$", errors)
    if not errors:
        validate_semantics(data, args.source, errors)

    if errors:
        print(f"Validation failed with {len(errors)} error(s):")
        for error in errors:
            print(f"- {error}")
        return 1

    counts = {
        "sections": len(data["sections"]),
        "motifFamilies": len(data["motifFamilies"]),
        "leftHandAnalysisMode": data["leftHandAnalysisMode"],
        "leftHandChordGrouping": (
            data["leftHandChordGrouping"]["defaultMode"]
            if data["leftHandChordGrouping"] is not None
            else None
        ),
        "leftHandChordFamilies": len(data["leftHandChordFamilies"]),
        "leftHandTextureFamilies": len(data["leftHandTextureFamilies"]),
    }
    print(f"Validation passed: {args.analysis}")
    print(json.dumps(counts, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
