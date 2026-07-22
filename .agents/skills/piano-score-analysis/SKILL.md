---
name: piano-score-analysis
description: Analyze, revise, and validate PianoAI built-in MusicXML or MXL scores into score-analysis Schema 2.1.0, including independent form segmentation, motif/theme families, texture-aware left-hand analysis, evidence, cross-validation, and manifest integration. Use when Codex needs to add a new PianoAI library analysis, improve an existing analysis JSON, regenerate chord occurrences, author polyphonic left-hand texture families, review analysis quality, or verify complete library coverage.
---

# Piano Score Analysis

Produce static, reviewable analysis for PianoAI. Treat the exact source score as the fact authority, deterministic scripts as evidence tools, and musical interpretation as a separate judgment layer. Generate results offline; never add runtime model analysis.

## Required order

1. Identify one exact library source file and choose a stable lowercase score ID.
2. Generate or refresh facts:

```powershell
npm run analysis:inspect -- "data/scores/<score-id>.mxl" `
  --output ".cache/analysis-facts/<score-id>.facts.json"
```

3. Read `references/analysis-guide.md` and the generated facts. Confirm source hash, internal measures, complete-measure count, pickup/tail durations, display-number map, key/meter/tempo changes, ranges, and exact repeated sequences. Facts are disposable working data under `.cache`; do not commit them.
4. Do not infer major mode from a key signature whose MusicXML `<mode>` is absent. Establish mode from work identity, tonic/cadence evidence, and score spelling; store material ambiguity and evidence in the analysis JSON's `crossValidation` and relevant explanation fields.
   Use `pickupMeasureIndex: null` when the opening measure is complete.
5. Inspect the score around every proposed section boundary and repeated sequence. Exact-repeat output is evidence, not a form label.
6. Research suitable independent sources when available. Prefer scholarly, institutional, edition, or detailed pedagogical sources. Store adopted sources and material conflicts in `sources` and `crossValidation` instead of creating a separate report.
7. Read `references/left-hand-analysis-conventions.md`. Decide whether the lower-staff material forms defensible metrical chord groups or a polyphonic texture before generating any families. Store the decision in `leftHandAnalysisMode`; never select a mode from the title.
8. Read `references/schema-guide.md`. Start from `assets/analysis-template.json` and replace every placeholder. In `chord-groups` mode configure `leftHandChordGrouping`; in `polyphonic-texture` mode keep grouping `null` and author reviewed texture families.
9. Write an independent analysis for the piece. Do not copy section counts, form labels, motif names, chord grouping, or prose from another score.
10. For `chord-groups`, generate duration-aware left-hand occurrences:

```powershell
npm run analysis:chords -- data/analyses/<score-id>.json
```

11. Inspect the resulting left-hand analysis. For `chord-groups`, confirm that every occurrence is one defensible accompaniment group rather than an arbitrary time slice. For `polyphonic-texture`, confirm that each family represents a bass framework, sustained interval, voice-leading chain, or closing gesture with explicit score evidence; do not repeat one held state once per beat.
12. Validate the file:

```powershell
python tools/score-analysis/validate_analysis.py `
  data/analyses/<score-id>.json `
  --schema schemas/score-analysis.schema.json `
  --source "data/scores/<score-id>.mxl"

npm run analysis:chords -- --check data/analyses/<score-id>.json
```

13. Add the `data/catalog.json` entry only after single-file validation passes.
14. Validate complete coverage and integration:

```powershell
npm run analysis:validate
npm test -- --run
npm run build
```

15. Verify the actual app on desktop and `390x844`: structure, motif, left-hand family selection, occurrence navigation, range playback, vertical cursor, long-score rendering, detail expansion, and horizontal overflow.

## Evidence rules

- Source MusicXML/MXL outranks commentary for notation, coordinates, tempo, spelling, dynamics, and repeats.
- Deterministic equality outranks visual impression for claims of exact reuse.
- Exact equality does not prove thematic importance; position, cadence, harmony, texture, and function still matter.
- External sources support interpretation but never override conflicting score facts silently.
- Keep source facts, deterministic results, external claims, and interpretation distinguishable.
- Use `confidence`, `alternatives`, and `crossValidation.status` for genuine ambiguity.
- Do not claim a stable modulation from a brief tonicization or chromatic color.
- Do not invent note-level roots for free cadenzas, linear diminished sonorities, incomplete pitch sets, or polyphonic lower-staff states.

## Independent adaptation rules

- Segment by the piece's actual phrase, cadence, tempo, key, texture, and repetition boundaries.
- A short ternary character piece, a variation nocturne, a modular rondo, and a long pedal-field nocturne require different section maps.
- Use motif families for both exact reuse and meaningful variants. Record the relation and local differences per occurrence.
- Prefer memory-relevant modules: exact 6-, 8-, or 16-measure blocks; repeated cadence units; changed exits; pedal waves; or phrase-ending gestures.
- Avoid families built only from trivial one-note coincidences or generic accompaniment unless the pattern has clear structural or practice value.
- Keep tonal interpretation inside the relevant section or motif prose.
- Left-hand chord families answer what the accompaniment group contains, where it repeats, and how bass or voicing changes.

## Proven coverage

- `chopin-nocturne-op9-no2`: compound 12/8, variation chain, duplicate display measure, cadenza.
- `schumann-traumerei-op15-no7`: ternary 8+8+8, `polyphonic-texture`, sustained intervals, exact three-measure lower-staff return.
- `chopin-waltz-a-minor`: turnaround, repeated dominant-tonic units, parallel-major episode, four-measure coda.
- `chopin-nocturne-op9-no1`: compound-duple 6/4 grouped into two accompaniment chords per complete measure, overlapping periodic repeats, long D-flat/A-flat pedal field, Picardy close.
- `chopin-waltz-c-sharp-minor`: 194 internal measures, A-B-C-B-A-B rondo, exact 16-measure modules, C-sharp-minor/D-flat-major enharmonic key change.

Use these as tests of generality, not prose templates.

## Completion gate

Complete one score only when:

- source hash and identity match;
- Schema and semantic validation have zero errors;
- every range, ID, source, motif link, and manifest entry resolves;
- sections cover a defensible ordered structure without copied labels;
- motif occurrences distinguish exact reuse from variation;
- `leftHandAnalysisMode` records the reviewed texture decision instead of relying on an implicit guess;
- chord families were regenerated after final grouping decisions, or polyphonic texture families were independently audited;
- material limitations and cross-validation outcomes are represented in the analysis JSON;
- desktop/mobile navigation, chord clicking, playback, and cursor behavior work on the real score.

Complete the library only when `npm run analysis:validate` passes with `--require-complete` through the package script.

## Future-stage boundary

Keep static `ScoreAnalysis` independent from future performance data. Audio transcription and user MIDI/audio assessment should use a separate performance/alignment schema keyed by `scoreId`, `sourceHash`, and `ScoreRange`. Do not add onset estimates, velocity, pedal, alignment confidence, or user advice to Schema 2.1.0.

Read `references/future-stages.md` before adding score-note identity, audio alignment, reference-performance comparison, or practice-assessment fields. Never persist the parser's temporary `n-*` note IDs as cross-version identities.
