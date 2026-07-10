# Schema Guide

## Contract

- Schema file: `analysis/schema/score-analysis.schema.json`
- Current version: `2.1.0`
- Analysis files: `public/analysis/<score-id>.analysis.json`
- Library mapping: `public/analysis/manifest.json`

Do not add fields that are not declared by the Schema. Propose a schema change only when the information cannot be represented by existing fields.

## Coordinates

`ScoreRange` is half-open: `[start, end)`.

`pickupMeasureIndex` is the internal index of an actual incomplete opening measure. Use `null` when the score has no pickup.

```json
{
  "start": { "measureIndex": 13, "offsetQuarter": { "numerator": 0, "denominator": 1 } },
  "end": { "measureIndex": 17, "offsetQuarter": { "numerator": 0, "denominator": 1 } }
}
```

This covers internal measures 13 through 16. `measureIndex` follows MusicXML document order, not the printed number. The end may equal `internalMeasureCount` only as a zero-offset end sentinel.

Use rational quarter-note offsets. Do not store floating-point beat offsets.

## IDs And References

- IDs use lowercase letters, digits, and hyphens and start with a letter.
- Keep IDs globally unique across sources, validation entries, sections, motif families and occurrences, and all left-hand families and occurrences.
- `sourceRefs[].sourceId` and `crossValidation[].sourceIds[]` must reference `sources[].id`.
- `sections[].relatedMotifFamilyIds[]` must reference `motifFamilies[].id`.
- Keep IDs stable when wording changes.

## Collections

- `form`: primary form label and concise structural summary. It is shown as context inside the structure view, not as a separate analysis category.
- `sections`: complete ordered formal map with tonality, structural role, and score-grounded explanation.
- `motifFamilies`: recognition basis plus occurrence-level relationships and differences.
- `leftHandAnalysisMode`: reviewed choice between `chord-groups` and `polyphonic-texture`.
- `leftHandChordGrouping`: grouping configuration for chord mode; `null` in polyphonic mode.
- `leftHandChordFamilies`: generated accompaniment-group pitch collections for chord mode; empty in polyphonic mode.
- `leftHandTextureFamilies`: reviewed bass, sustained-interval, voice-leading, and closing units for polyphonic mode; empty in chord mode.
- `crossValidation`: important external or disputed claims and adopted conclusions.

## Versioning

`schemaVersion` describes the data contract. `analysisVersion` describes revisions to one analysis result. Increase `analysisVersion` when musical content changes while the Schema remains compatible.

Schema `2.1.0` adds an explicit left-hand analysis mode so polyphonic lower-staff writing is not forced into beat-level chord collections. It retains the removal of standalone overview, static practice, memory-anchor, and similar-passage collections from `2.0.0`.

Tonal direction belongs in section and motif explanations. Chord collections remain literal configured accompaniment groups; polyphonic texture families describe concrete lower-staff voice behavior without claiming complete harmony.

Keep future audio or user-performance analysis in a separate contract. Reference this static score analysis by `scoreId`, `sourceHash`, and `ScoreRange`; do not add performance timing, velocity, pedal, alignment, or advice fields to Schema `2.1.0`.
