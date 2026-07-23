# PianoAI Agent Guide

## Communication and language

- Respond to the user in Chinese with a clear, non-repetitive structure.
- Write code, UI copy, code comments, and image annotations in English.
- Before editing, inspect the relevant code and identify material ambiguity. Ask the user only when repository evidence cannot resolve a choice that would change behavior or scope.
- Keep progress updates concise and report failed checks honestly.

## Read the matching skill first

- Use `.agents/skills/piano-score-ingestion/SKILL.md` for new or replacement library scores.
- Use `.agents/skills/piano-score-analysis/SKILL.md` for static musical analysis, section/motif work, or left-hand analysis.
- Use `.agents/skills/piano-reference-performance/SKILL.md` for reference sources, audio, transcription, alignment, evaluation, interpretation, comparison, or R2 records.
- Follow linked skill references only when their stage is active. Do not copy one score's interpretation into another score.

## Source-of-truth order

1. Exact `data/scores/<score-id>.mxl` bytes own notation facts and score identity.
2. Deterministic tools provide reviewable facts and equality evidence.
3. External sources support interpretation but never silently override score facts.
4. Human musical analysis owns form, motif significance, harmonic interpretation, texture classification, and ambiguity.
5. Reference audio and model output describe a performance, never the canonical notation.

Keep facts, model evidence, external claims, and interpretation distinguishable in data and prose.

## Data boundaries

- `data/` is versioned product data. Every catalog reference must resolve and validate.
- `assets/reference-audio/` contains original local reference recordings. It is ignored but not disposable; retain an external or R2 backup.
- Development audio is local-first with a content-addressed R2 fallback. Use the local URL reported by Vite; development must not depend on a fixed port.
- `.local/` contains rebuildable environments and model weights. Never commit it.
- `.cache/` contains disposable facts, transcriptions, alignments, reports, and test artifacts. Never commit it.
- Static `ScoreAnalysis` Schema 2.1.0 must not contain user performance, MIDI, audio alignment, velocity, pedal, or coaching fields.
- Reference interpretations must remain separate from future user-performance assessment data.

## Score identity

- Use one stable lowercase kebab-case `scoreId` across MXL, analysis, catalogs, and performance foreign keys.
- Library scores are currently published as `data/scores/<score-id>.mxl`; do not rename raw XML to MXL.
- A changed MXL SHA-256 is a new score revision. Regenerate facts and invalidate old reference alignment.
- Record provenance outside canonical MXL when the notation bytes are unchanged; do not rewrite MXL only to add metadata.
- Use zero-based internal `measureIndex` plus rational offsets. Display measure labels are not stable coordinates.
- Never persist parser-temporary `n-*` note IDs as cross-version identity.

## Static analysis

- Generate facts before interpretation with `npm run analysis:inspect`.
- Author analysis from the exact source, schema guide, and template; replace every placeholder.
- Decide `chord-groups` versus `polyphonic-texture` from the score texture, not title or precedent.
- Regenerate chord occurrences after final grouping decisions.
- Add `data/catalog.json` only after the single file validates.
- Complete with `npm run analysis:validate`, tests, build, and real desktop/mobile UI verification.

## Reference performance

- Run `npm run performance:setup` and `npm run performance:doctor` before model generation.
- Use automatic device selection. It must prefer CUDA when `torch.cuda.is_available()` is true and fall back to CPU otherwise.
- Keep PyTorch, Piano Transcription Inference, librosa, checkpoint URL, size, and checksum pinned in setup files.
- Process one reference before a batch. Batch generation defaults to one worker; increase only after measuring GPU memory.
- Do not reuse cached transcription after audio, score, normalization, model, checkpoint, or algorithm changes.
- Preserve the identity chain: `scoreId + sourceHash`, `interpretationId`, audio SHA-256, evaluation ID, and canonical evaluation SHA-256.
- Hash protected JSON with `canonicalTextSha256`; raw line-ending-dependent hashes are invalid across Windows and POSIX.
- Treat automatic validation as a publish gate, not artistic ground truth.

## Frontend development

- Preserve the established React, TypeScript, OSMD, Tone.js, and Lucide patterns.
- Keep practice, analysis, and performance state boundaries explicit.
- Follow `docs/responsive-layout.md` for the shared viewport profile, logical-landscape rotation, transformed coordinates, pointer capabilities, mode layouts, and verification matrix.
- Practice, analysis, and performance must use the same root `data-layout-mode`; never add a mode-specific orientation override or structural layout based on the physical portrait width.
- Maintain keyboard, pointer, MIDI, playback, and selection behavior when editing shared score interaction code.
- Test desktop and `390x844` mobile layouts. Check overflow, long-score rendering, range navigation, cursor position, and audio controls.
- Do not add runtime AI calls for built-in score analysis or reference interpretation generation.

## Validation matrix

Use the narrowest relevant check while iterating, then run the full gate before completion:

```powershell
npm run check
npm run build:local
```

For online builds, set `VITE_REFERENCE_AUDIO_BASE_URL` and use `npm run build`. Do not upload R2 objects, change CORS, publish, or deploy without explicit authorization. Use `performance:r2:sync -- --dry-run` before any authorized sync.

## Repository hygiene

- Preserve unrelated user changes in a dirty worktree.
- Use structured parsers for JSON, MusicXML, and MXL rather than ad hoc text replacement.
- Keep generated cache and local media out of Git.
- Avoid broad refactors while changing a data pipeline stage.
- Update README for user-facing capabilities, this file for engineering invariants, and project skills for repeatable agent workflows.
