import argparse
import json
from pathlib import Path

import librosa
import numpy as np
import pandas as pd
from scipy.interpolate import interp1d
from synctoolbox.dtw.mrmsdtw import sync_via_mrmsdtw
from synctoolbox.dtw.utils import make_path_strictly_monotonic
from synctoolbox.feature.chroma import pitch_to_chroma, quantize_chroma
from synctoolbox.feature.csv_tools import df_to_pitch_features, df_to_pitch_onset_features
from synctoolbox.feature.dlnco import pitch_onset_features_to_DLNCO
from synctoolbox.feature.pitch import audio_to_pitch_features
from synctoolbox.feature.pitch_onset import audio_to_pitch_onset_features
from synctoolbox.feature.utils import estimate_tuning


SAMPLE_RATE = 22_050
MIDI_MIN = 21
MIDI_MAX = 108


def percentile(values, quantile):
    if not values:
        return 0.0
    return float(np.quantile(np.asarray(values, dtype=np.float64), quantile))


def symbolic_dataframe(score, duration_seconds):
    scale = duration_seconds / score["totalTicks"]
    rows = []
    for event in score["events"]:
        rows.append({
            "start": event["startTick"] * scale,
            "duration": max(0.02, event["durationTicks"] * scale),
            "pitch": event["pitch"],
            "velocity": 64,
            "instrument": "Piano",
        })
    return pd.DataFrame(rows)


def audio_features(audio, feature_rate):
    tuning_offset = estimate_tuning(audio, SAMPLE_RATE)
    pitch = audio_to_pitch_features(
        f_audio=audio,
        Fs=SAMPLE_RATE,
        tuning_offset=tuning_offset,
        feature_rate=feature_rate,
        verbose=False,
    )
    chroma = quantize_chroma(pitch_to_chroma(f_pitch=pitch))
    pitch_onsets = audio_to_pitch_onset_features(
        f_audio=audio,
        Fs=SAMPLE_RATE,
        tuning_offset=tuning_offset,
        midi_min=MIDI_MIN,
        midi_max=MIDI_MAX,
        verbose=False,
    )
    dlnco = pitch_onset_features_to_DLNCO(
        f_peaks=pitch_onsets,
        feature_rate=feature_rate,
        feature_sequence_length=chroma.shape[1],
        visualize=False,
    )
    return chroma, dlnco, tuning_offset


def score_features(frame, feature_rate):
    pitch = df_to_pitch_features(
        frame,
        feature_rate=feature_rate,
        midi_min=MIDI_MIN,
        midi_max=MIDI_MAX,
        ignore_velocity=True,
    )
    chroma = quantize_chroma(pitch_to_chroma(f_pitch=pitch))
    pitch_onsets = df_to_pitch_onset_features(
        frame,
        midi_min=MIDI_MIN,
        midi_max=MIDI_MAX,
    )
    dlnco = pitch_onset_features_to_DLNCO(
        f_peaks=pitch_onsets,
        feature_rate=feature_rate,
        feature_sequence_length=chroma.shape[1],
        visualize=False,
    )
    return chroma, dlnco


def frame_similarity(audio_chroma, score_chroma, audio_index, score_index):
    left = audio_chroma[:, audio_index]
    right = score_chroma[:, score_index]
    denominator = np.linalg.norm(left) * np.linalg.norm(right)
    if denominator <= 1e-12:
        return 0.0
    return float(np.clip(np.dot(left, right) / denominator, 0.0, 1.0))


def build_time_map(score, warping_path, audio_chroma, score_chroma, feature_rate, audio_start):
    score_times = warping_path[1] / feature_rate
    audio_times = warping_path[0] / feature_rate
    warper = interp1d(score_times, audio_times, kind="linear", fill_value="extrapolate")
    nominal_duration = score_chroma.shape[1] / feature_rate
    anchors = []
    similarities = []
    previous_time_us = -1

    for onset in score["onsets"]:
        nominal_seconds = onset["tick"] / score["totalTicks"] * nominal_duration
        mapped_seconds = audio_start + float(warper(nominal_seconds))
        time_us = max(previous_time_us + 1_000, round(mapped_seconds * 1_000_000))
        score_frame = min(score_chroma.shape[1] - 1, max(0, round(nominal_seconds * feature_rate)))
        path_index = int(np.argmin(np.abs(warping_path[1] - score_frame)))
        local_similarities = []
        for offset in range(-2, 3):
            candidate = min(warping_path.shape[1] - 1, max(0, path_index + offset))
            local_similarities.append(frame_similarity(
                audio_chroma,
                score_chroma,
                int(warping_path[0, candidate]),
                int(warping_path[1, candidate]),
            ))
        similarity = float(np.median(local_similarities))
        similarities.append(similarity)
        anchors.append({
            "scorePosition": onset["scorePosition"],
            "timeUs": time_us,
            "confidence": round(0.55 + 0.4 * similarity, 4),
        })
        previous_time_us = time_us

    return anchors, similarities


def main():
    parser = argparse.ArgumentParser(description="Align a canonical score to a piano recording with Sync Toolbox.")
    parser.add_argument("--audio", required=True)
    parser.add_argument("--score-events", required=True)
    parser.add_argument("--piano-transcription", required=True)
    parser.add_argument("--score-id", required=True)
    parser.add_argument("--audio-sha256", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--feature-rate", type=int, default=50)
    args = parser.parse_args()

    score = json.loads(Path(args.score_events).read_text(encoding="utf-8"))
    transcription = json.loads(Path(args.piano_transcription).read_text(encoding="utf-8"))
    notes = [
        note for note in transcription["notes"]
        if MIDI_MIN <= int(note["midi_note"]) <= MIDI_MAX
    ]
    audio_start = min(float(note["onset_time"]) for note in notes)
    audio_end = max(float(note["offset_time"]) for note in notes)

    audio, _ = librosa.load(args.audio, sr=SAMPLE_RATE, mono=True)
    crop_start = max(0, round(audio_start * SAMPLE_RATE))
    crop_end = min(len(audio), round(audio_end * SAMPLE_RATE))
    cropped_audio = audio[crop_start:crop_end]
    active_duration = len(cropped_audio) / SAMPLE_RATE
    score_frame = symbolic_dataframe(score, active_duration)

    audio_chroma, audio_dlnco, tuning_offset = audio_features(cropped_audio, args.feature_rate)
    score_chroma, score_dlnco = score_features(score_frame, args.feature_rate)
    warping_path = sync_via_mrmsdtw(
        f_chroma1=audio_chroma,
        f_onset1=audio_dlnco,
        f_chroma2=score_chroma,
        f_onset2=score_dlnco,
        input_feature_rate=args.feature_rate,
        step_weights=np.array([1.5, 1.5, 2.0]),
        threshold_rec=10 ** 6,
        verbose=False,
    )
    warping_path = make_path_strictly_monotonic(warping_path)
    time_map, similarities = build_time_map(
        score,
        warping_path,
        audio_chroma,
        score_chroma,
        args.feature_rate,
        audio_start,
    )

    payload = {
        "schemaVersion": "2.0.0",
        "scoreId": args.score_id,
        "audioSha256": args.audio_sha256,
        "algorithm": "synctoolbox-mrmsdtw-score-informed-1",
        "effectiveRangeSeconds": [round(audio_start, 6), round(audio_end, 6)],
        "timeMap": time_map,
        "scoreAlignment": {
            "featureRate": args.feature_rate,
            "tuningOffsetCents": int(tuning_offset),
            "audioFrames": int(audio_chroma.shape[1]),
            "scoreFrames": int(score_chroma.shape[1]),
            "warpingPathFrames": int(warping_path.shape[1]),
            "anchorCount": len(time_map),
            "medianChromaSimilarity": round(percentile(similarities, 0.5), 4),
            "p10ChromaSimilarity": round(percentile(similarities, 0.1), 4),
            "p90ChromaSimilarity": round(percentile(similarities, 0.9), 4),
        },
        "models": {
            "pianoTranscriptionInference": {
                "version": transcription.get("backend", "piano-transcription-inference"),
                "noteCount": len(notes),
                "pedalEventCount": len(transcription["pedals"]),
            },
        },
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(output),
        "effectiveRangeSeconds": payload["effectiveRangeSeconds"],
        "scoreAlignment": payload["scoreAlignment"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
