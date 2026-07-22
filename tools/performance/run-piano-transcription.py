import argparse
import json
from pathlib import Path

import numpy as np
import torch
from piano_transcription_inference import PianoTranscription, load_audio, sample_rate


def json_value(value):
    if isinstance(value, np.generic):
        return value.item()
    raise TypeError(f"Unsupported value: {type(value)!r}")


def main():
    parser = argparse.ArgumentParser(description="Run Piano Transcription Inference in an isolated environment.")
    parser.add_argument("audio")
    parser.add_argument("checkpoint")
    parser.add_argument("output_midi")
    parser.add_argument("output_json")
    args = parser.parse_args()

    output_midi = Path(args.output_midi)
    output_json = Path(args.output_json)
    output_midi.parent.mkdir(parents=True, exist_ok=True)
    output_json.parent.mkdir(parents=True, exist_ok=True)

    audio, _ = load_audio(args.audio, sr=sample_rate, mono=True)
    transcriptor = PianoTranscription(
        device=torch.device("cpu"),
        checkpoint_path=str(Path(args.checkpoint).resolve()),
    )
    result = transcriptor.transcribe(audio, str(output_midi))
    payload = {
        "backend": "piano-transcription-inference-0.0.6",
        "sampleRate": sample_rate,
        "notes": result["est_note_events"],
        "pedals": result["est_pedal_events"],
    }
    output_json.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=json_value),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
