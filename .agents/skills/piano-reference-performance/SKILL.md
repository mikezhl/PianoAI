---
name: piano-reference-performance
description: Turn professional piano recording links or local reference audio into normalized, score-aligned PianoAI performance records, including source planning, acquisition, GPU-first transcription with CPU fallback, score synchronization, evaluation, interpretation generation, validation, reporting, and deployment metadata. Use when Codex needs to add, regenerate, audit, compare, or repair a reference performance or its catalog, evaluation, interpretation, cache, or R2 audio records.
---

# Piano Reference Performance

Produce reproducible professional interpretation data tied to one canonical library score. Keep source identity, audio facts, model evidence, published interpretation, and comparative judgment as separate layers.

## Required order

1. Read `references/performance-data-contract.md`.
2. Require a complete built-in score and validated static analysis. Confirm `scoreId` and `sourceHash` in `data/catalog.json`; never align against a temporary browser import.
3. Establish one source identity. Confirm performer, work, edition/cuts, stable URL, recording boundaries, and permission to process the source. Use a lowercase stable `interpretationId`; never identify a recording by performer name alone.
4. Add or update one plan item in `tools/performance/config/reference-sources.json` when automatic collection is appropriate. Keep `interpretationId`, `scoreId`, performer identity, local `.m4a` filename, title, and source URL explicit.
5. Prepare and verify the local environment:

```powershell
npm run performance:setup
npm run performance:doctor
```

   Use the default `auto` device selection. It selects CUDA when PyTorch can use an NVIDIA GPU and CPU otherwise. To force CPU for diagnosis, set `$env:PIANOAI_TRANSCRIPTION_DEVICE = "cpu"` for the generation command.
6. Collect one planned source, or place an authorized local recording at the exact catalog filename:

```powershell
npx tsx tools/performance/collect-reference-audio.ts `
  --reference <interpretation-id>
```

7. Inspect the resulting `data/performances/catalog.json` record. Confirm score hash, performer, evidence ID, original source URL/title, local filename, audio SHA-256, duration, sample rate, channels, MIME, content-addressed object key, and storage target. Listen to the beginning and end; reject wrong works, narration-heavy uploads, truncation, duplicates, or material edits.
8. Generate one performance first:

```powershell
npx tsx tools/performance/generate-reference-performance.ts `
  --reference <interpretation-id>
```

   The pipeline normalizes a cache WAV, transcribes notes and pedal, exports canonical score events, synchronizes the full score, evaluates note matching, and generates the interpretation. Do not use `--reuse-transcriptions` after audio bytes, trimming, model, or checkpoint changes.
9. Review `.cache/performance-tests/<interpretation-id>/`, the generated evaluation, and the generated interpretation. Confirm effective audio range, time-map monotonicity, section coverage, onset residuals, uncertain/extra events, ornaments, releases, velocities, and pedal plausibility. Automatic status is a gate, not proof of artistic correctness.
10. Validate and finalize all derived records:

```powershell
npm run performance:validate
npm run performance:finalize
npm test -- --run
npm run build:local
```

11. Verify performance mode on desktop and `390x844`: reference switching, original audio, normalized playback, overlays, cursor movement, section/range navigation, long-score layout, and unavailable dimensions.
12. For online delivery, validate local hashes before upload:

```powershell
npm run performance:r2:sync -- --dry-run
npm run performance:r2:sync
```

   Treat upload as a separate, explicitly authorized deployment action.

## Batch rule

Generate one reference successfully before using `performance:generate:planned` or `performance:generate -- --all`. Keep GPU batch workers conservative; a single model process per GPU is the default unless measured memory headroom proves otherwise.

## Evidence rules

- Canonical score bytes own pitch, order, notation, and structural coordinates.
- Source catalog owns recording identity and immutable audio facts.
- Transcription owns acoustic candidates, not score truth.
- Evaluation owns offline alignment evidence and limitations.
- Interpretation owns browser-facing time maps and expression data.
- Comparative reports under `.cache/reports/performance/` are derived artifacts, not source records.
- Never silently promote weak model output into an automatically validated dimension.
- Never add user practice assessment, personal audio, or MIDI performance fields to the reference interpretation schema.

## Completion gate

Complete one reference only when source and audio identities resolve, the score hash matches, model runtime and device are recorded in working evidence, evaluation and interpretation hashes validate, automatic gates are internally consistent, local audio plays, and the real performance UI behaves correctly.
