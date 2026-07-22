import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

import torch
import piano_transcription_inference
from piano_transcription_inference import PianoTranscription


EXPECTED_CHECKPOINT_MD5 = "22b961b77c1878239fec963362097045"
EXPECTED_CHECKPOINT_SIZE = 171_966_578


def file_md5(path):
    digest = hashlib.md5()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description="Check the PianoAI performance model environment.")
    parser.add_argument("--checkpoint", required=True)
    args = parser.parse_args()

    checkpoint = Path(args.checkpoint)
    checkpoint_valid = (
        checkpoint.exists()
        and checkpoint.stat().st_size == EXPECTED_CHECKPOINT_SIZE
        and file_md5(checkpoint) == EXPECTED_CHECKPOINT_MD5
    )
    cuda_available = torch.cuda.is_available()
    selected_device = "cuda" if cuda_available else "cpu"
    model_loaded = False
    if checkpoint_valid:
        transcriptor = PianoTranscription(
            device=torch.device(selected_device),
            checkpoint_path=str(checkpoint.resolve()),
        )
        model_loaded = next(transcriptor.model.parameters()).device.type == selected_device
        del transcriptor
        if cuda_available:
            torch.cuda.empty_cache()
    payload = {
        "pythonRuntime": sys.executable,
        "pianoTranscriptionInference": getattr(piano_transcription_inference, "__version__", "0.0.6"),
        "torch": torch.__version__,
        "torchCuda": torch.version.cuda,
        "cudaAvailable": cuda_available,
        "gpu": torch.cuda.get_device_name(0) if cuda_available else None,
        "selectedDevice": selected_device,
        "ffmpeg": shutil.which("ffmpeg"),
        "ffprobe": shutil.which("ffprobe"),
        "checkpoint": str(checkpoint.resolve()),
        "checkpointValid": checkpoint_valid,
        "modelLoaded": model_loaded,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    if not payload["ffmpeg"] or not payload["ffprobe"] or not checkpoint_valid or not model_loaded:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
