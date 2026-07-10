#!/usr/bin/env python3
"""Extract deterministic, reviewable facts from a MusicXML or MXL piano score."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import zipfile
from collections import defaultdict
from fractions import Fraction
from pathlib import Path
from typing import Any, Iterable
from xml.etree import ElementTree as ET


STEP_TO_SEMITONE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
MAJOR_KEYS = {-7: "C-flat", -6: "G-flat", -5: "D-flat", -4: "A-flat", -3: "E-flat", -2: "B-flat", -1: "F", 0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F-sharp", 7: "C-sharp"}
MINOR_KEYS = {-7: "A-flat", -6: "E-flat", -5: "B-flat", -4: "F", -3: "C", -2: "G", -1: "D", 0: "A", 1: "E", 2: "B", 3: "F-sharp", 4: "C-sharp", 5: "G-sharp", 6: "D-sharp", 7: "A-sharp"}


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def children(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in list(element) if local_name(child.tag) == name]


def child(element: ET.Element | None, name: str) -> ET.Element | None:
    if element is None:
        return None
    return next((candidate for candidate in list(element) if local_name(candidate.tag) == name), None)


def descendant(root: ET.Element, name: str) -> ET.Element | None:
    return next((element for element in root.iter() if local_name(element.tag) == name), None)


def descendants(root: ET.Element, name: str) -> list[ET.Element]:
    return [element for element in root.iter() if local_name(element.tag) == name]


def text(element: ET.Element | None, default: str = "") -> str:
    return (element.text or "").strip() if element is not None else default


def int_text(element: ET.Element | None, default: int = 0) -> int:
    try:
        return int(text(element))
    except ValueError:
        return default


def load_musicxml(path: Path) -> bytes:
    if path.suffix.lower() != ".mxl":
        return path.read_bytes()

    with zipfile.ZipFile(path) as archive:
        container = ET.fromstring(archive.read("META-INF/container.xml"))
        rootfile = next((element for element in container.iter() if local_name(element.tag) == "rootfile"), None)
        score_path = rootfile.get("full-path") if rootfile is not None else None
        if not score_path:
            raise ValueError("MXL container does not define a score rootfile")
        return archive.read(score_path)


def pitch_info(note: ET.Element) -> tuple[str, int] | None:
    pitch = child(note, "pitch")
    if pitch is None:
        return None
    step = text(child(pitch, "step"))
    octave = int_text(child(pitch, "octave"), -99)
    alter = int_text(child(pitch, "alter"), 0)
    if step not in STEP_TO_SEMITONE or octave < -1:
        return None
    accidental = "##" if alter == 2 else "#" if alter == 1 else "b" if alter == -1 else "bb" if alter == -2 else ""
    return f"{step}{accidental}{octave}", (octave + 1) * 12 + STEP_TO_SEMITONE[step] + alter


def fraction_text(value: Fraction) -> str:
    return str(value.numerator) if value.denominator == 1 else f"{value.numerator}/{value.denominator}"


def key_name(fifths: int, mode: str) -> str:
    if not mode:
        return f"{fifths} fifths (mode unspecified)"
    normalized_mode = mode.lower()
    names = MINOR_KEYS if normalized_mode == "minor" else MAJOR_KEYS
    tonic = names.get(fifths, f"{fifths} fifths")
    return f"{tonic} {normalized_mode}"


def score_title(root: ET.Element, source: Path) -> str:
    for name in ("work-title", "movement-title"):
        value = text(descendant(root, name))
        if value:
            return value
    return re.sub(r"\.(?:mxl|musicxml|xml)$", "", source.name, flags=re.IGNORECASE)


def composer(root: ET.Element) -> str:
    creators = descendants(root, "creator")
    preferred = next((item for item in creators if item.get("type") == "composer" and text(item)), None)
    selected = preferred if preferred is not None else (creators[0] if creators else None)
    return text(selected, "Unknown")


def measure_signature(events: list[dict[str, Any]], staff: int | None = None) -> str:
    selected = [event for event in events if staff is None or event["staff"] == staff]
    tokens = [
        f'{event["onset"]}:{event["duration"]}:{event["pitch"]}:{event["staff"]}:{event["voice"]}'
        for event in sorted(selected, key=lambda item: (Fraction(item["onset"]), item["staff"], item["voice"], item["pitch"], Fraction(item["duration"])))
    ]
    return "|".join(tokens)


def repeated_sequences(signatures: list[str], minimum: int = 2, maximum: int = 16) -> list[dict[str, int]]:
    matches: list[dict[str, int]] = []
    size = len(signatures)
    for first in range(size):
        for second in range(first + 1, size):
            if not signatures[first] or signatures[first] != signatures[second]:
                continue
            if first > 0 and second > 0 and signatures[first - 1] == signatures[second - 1]:
                continue
            length = 0
            while first + length < size and second + length < size and signatures[first + length] == signatures[second + length]:
                length += 1
            if length >= minimum:
                matches.append({"firstStart": first, "secondStart": second, "length": min(length, maximum)})
    return sorted(matches, key=lambda item: (-item["length"], item["firstStart"], item["secondStart"]))


def extract(source: Path) -> dict[str, Any]:
    raw = load_musicxml(source)
    root = ET.fromstring(raw)
    parts = children(root, "part")
    if not parts:
        raise ValueError("Score contains no MusicXML part")

    first_measures = children(parts[0], "measure")
    display_numbers = [measure.get("number") or str(index + 1) for index, measure in enumerate(first_measures)]
    measure_events: list[list[dict[str, Any]]] = [[] for _ in first_measures]
    measure_used_quarters = [Fraction(0) for _ in first_measures]
    measure_note_counts = [defaultdict(int) for _ in first_measures]
    meters: list[dict[str, Any]] = []
    keys: list[dict[str, Any]] = []
    tempos: list[dict[str, Any]] = []
    all_midis: list[int] = []

    for part_index, part in enumerate(parts):
        divisions = 1
        current_meter = (4, 4)
        for measure_index, measure in enumerate(children(part, "measure")):
            if measure_index >= len(measure_events):
                break
            cursor = Fraction(0)
            furthest = Fraction(0)
            previous_onset = Fraction(0)
            for item in list(measure):
                name = local_name(item.tag)
                if name == "attributes":
                    next_divisions = int_text(child(item, "divisions"), divisions)
                    divisions = max(1, next_divisions)
                    time = child(item, "time")
                    if time is not None:
                        current_meter = (int_text(child(time, "beats"), 4), int_text(child(time, "beat-type"), 4))
                        if part_index == 0:
                            meters.append({"measureIndex": measure_index, "meter": f"{current_meter[0]}/{current_meter[1]}"})
                    key = child(item, "key")
                    if key is not None and part_index == 0:
                        fifths = int_text(child(key, "fifths"), 0)
                        mode = text(child(key, "mode"))
                        keys.append({"measureIndex": measure_index, "fifths": fifths, "mode": mode, "name": key_name(fifths, mode)})
                    continue
                if name == "backup":
                    cursor -= Fraction(int_text(child(item, "duration"), 0), divisions)
                    continue
                if name == "forward":
                    cursor += Fraction(int_text(child(item, "duration"), 0), divisions)
                    furthest = max(furthest, cursor)
                    continue
                if name == "direction" and part_index == 0:
                    sound = child(item, "sound")
                    if sound is not None and sound.get("tempo"):
                        tempos.append({"measureIndex": measure_index, "tempo": sound.get("tempo")})
                    continue
                if name != "note":
                    continue

                duration = Fraction(int_text(child(item, "duration"), 0), divisions)
                is_chord = child(item, "chord") is not None
                is_grace = child(item, "grace") is not None
                onset = previous_onset if is_chord else cursor
                if not is_chord:
                    previous_onset = onset
                staff = int_text(child(item, "staff"), 1)
                voice = text(child(item, "voice"), "1")
                pitch = pitch_info(item)
                event = {
                    "onset": fraction_text(onset),
                    "duration": fraction_text(duration),
                    "pitch": pitch[0] if pitch else "R",
                    "staff": staff,
                    "voice": voice,
                    "part": part_index + 1,
                    "grace": is_grace,
                }
                measure_events[measure_index].append(event)
                if pitch:
                    all_midis.append(pitch[1])
                    measure_note_counts[measure_index][str(staff)] += 1
                if not is_chord and not is_grace:
                    cursor += duration
                    furthest = max(furthest, cursor)
            measure_used_quarters[measure_index] = max(measure_used_quarters[measure_index], furthest)

    full_signatures = [measure_signature(events) for events in measure_events]
    right_signatures = [measure_signature(events, 1) for events in measure_events]
    left_signatures = [measure_signature(events, 2) for events in measure_events]
    opening_meter = meters[0]["meter"] if meters else "4/4"
    beats, beat_type = (int(value) for value in opening_meter.split("/", 1))
    nominal_quarters = Fraction(beats * 4, beat_type)
    has_pickup = bool(measure_used_quarters and 0 < measure_used_quarters[0] < nominal_quarters)
    pickup_index = 0 if has_pickup else None
    unique_display = list(dict.fromkeys(display_numbers[1:] if has_pickup else display_numbers))

    measures = []
    for index, events in enumerate(measure_events):
        measures.append({
            "measureIndex": index,
            "displayNumber": display_numbers[index],
            "usedQuarterDuration": fraction_text(measure_used_quarters[index]),
            "noteCountsByStaff": dict(sorted(measure_note_counts[index].items())),
            "fullSignature": full_signatures[index],
            "rightSignature": right_signatures[index],
            "leftSignature": left_signatures[index],
        })

    return {
        "sourceFile": source.name,
        "sourceHash": f"sha256:{hashlib.sha256(source.read_bytes()).hexdigest().upper()}",
        "title": score_title(root, source),
        "composer": composer(root),
        "partCount": len(parts),
        "internalMeasureCount": len(first_measures),
        "displayMeasureCount": len(unique_display),
        "pickupMeasureIndex": pickup_index,
        "measureNumberByIndex": display_numbers,
        "openingKey": keys[0]["name"] if keys else "Unknown",
        "openingMeter": opening_meter,
        "keyChanges": keys,
        "meterChanges": meters,
        "tempoChanges": tempos,
        "pitchRangeMidi": {"lowest": min(all_midis), "highest": max(all_midis)} if all_midis else None,
        "exactRepeatedSequences": {
            "fullScore": repeated_sequences(full_signatures),
            "rightHand": repeated_sequences(right_signatures),
            "leftHand": repeated_sequences(left_signatures),
        },
        "measures": measures,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report = extract(args.source)
    serialized = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    else:
        print(serialized, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
