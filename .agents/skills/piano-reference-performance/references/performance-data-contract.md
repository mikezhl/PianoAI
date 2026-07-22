# Performance Data Contract

## Record flow

```text
source link or authorized local audio
  -> source plan
  -> reference audio + normalized catalog record
  -> disposable mono WAV and model transcription cache
  -> full-score synchronization
  -> offline evaluation
  -> browser-facing interpretation
  -> comparative reports
  -> optional content-addressed R2 object
```

## Layer ownership

| Layer | Location | Authority | Git |
| --- | --- | --- | --- |
| Source plan | `tools/performance/config/reference-sources.json` | Repeatable acquisition intent | Yes |
| Source audio | `assets/reference-audio/` | Original local recording bytes | No |
| Reference catalog | `data/performances/catalog.json` | Source, performer, score, audio, and object identity | Yes |
| Model/alignment cache | `.cache/performance-tests/` | Rebuildable intermediate evidence | No |
| Evaluation | `data/performances/evaluations/` | Offline alignment metrics and limitations | Yes, build-only |
| Interpretation | `data/performances/interpretations/` | Browser-facing aligned expression data | Yes, runtime |
| Comparison reports | `.cache/reports/performance/` | Derived cross-reference summaries | No |

## Identity chain

- `scoreId + sourceHash` identifies the exact canonical notation source.
- `interpretationId` identifies one performer and recording source.
- `audio.sha256` identifies the original local audio bytes.
- `audio.objectKey` is content-addressed from the lowercase audio SHA-256 plus extension.
- `generation.evaluationId` equals `interpretationId`.
- `generation.evaluationSha256` hashes canonical LF text so Windows and POSIX checkouts agree.

## Model boundary

FFmpeg produces mono 22,050 Hz cache audio. Piano Transcription Inference proposes note onsets, releases, velocity, pedal, and ornament candidates. Synctoolbox aligns score features to the full recording. Score-informed matching reconciles candidates with canonical score notes. Automatic validation publishes only dimensions that meet policy gates.

The default transcription device is `auto`: use CUDA when `torch.cuda.is_available()` is true, otherwise CPU. `npm run performance:doctor` must verify FFmpeg, FFprobe, yt-dlp, Synctoolbox, PyTorch, checkpoint integrity, model loading, selected device, and GPU identity when present.

## Cache invalidation

Discard cached transcription and alignment when any of these change:

- audio bytes, trimming, channel mix, or sample-rate normalization;
- canonical score bytes or `sourceHash`;
- transcription package, PyTorch runtime, checkpoint, or thresholds;
- synchronization algorithm, feature rate, or score-event export;
- matching algorithm or automatic validation policy.

Regenerate the evaluation before the interpretation so its canonical content hash is current.
