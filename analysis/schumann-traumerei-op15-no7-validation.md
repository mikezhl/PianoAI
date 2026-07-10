# Schumann · Träumerei Op. 15 No. 7 · Validation

## Source identity

- Library file: `Kinderszenen Op. 15 No. 7 - Traumerei.mxl`
- SHA-256: `01A46C8C52741B7A458487DFB8AAAC7EC19A78151E58F5282384C3AECB1BBB7F`
- Internal measures: 25
- Complete notated measures: 24
- Meter: 4/4
- Key: F major. The MusicXML key signature contains one flat but omits `<mode>`; the mode is confirmed from the title/repertoire identity, opening tonic sonority, cadences, and final F-major closure rather than inferred from the signature alone.
- Pickup: internal measure 0 is one quarter; internal measure 24 is three quarters. Together they complete one 4/4 frame.

## Independent structural decision

The analysis uses ternary form `A(a-a')-B(b-b')-A'(a''-closing)`.

- The score contains six consecutive four-measure phrases after the pickup.
- Phrases 1-2 form the first eight-measure A section.
- Phrases 3-4 leave the opening tonic field through G minor, B-flat major, and D minor regions.
- Phrases 5-6 return to the opening material and complete the final tonic closure.
- Teoria independently describes the first section as two four-measure phrases and treats the work as ternary form.

This is deliberately not modeled after the repeated four-measure variation chain used for Chopin Op. 9 No. 2.

## Deterministic repetition evidence

The score-facts extractor found:

- no exact repeated full-score measure sequence;
- no exact repeated right-hand measure sequence;
- one three-measure exact left-hand sequence, internal m3-5 repeated at m19-21.

Therefore the return is labeled `near-exact`, not `exact`. Similarity is established by phrase position, contour, bass plan, and cadential role, while the changed inner voices and surface rhythm remain visible in each occurrence.

## Motif-family decisions

1. `motif-opening-phrase` groups the four outer-section phrases by pickup behavior, long melodic span, and four-measure syntax.
2. `motif-middle-sequence` groups the two middle phrases by applied-dominant accidentals and sequential tonal movement.
3. `motif-delayed-cadence` isolates the recurring phrase-ending suspension/late-resolution behavior because it is useful for phrasing, memory, and voicing practice.

The families are not based on exact-note equality alone. Each occurrence records whether the relationship is representative, near-exact, extended, or intensified.

## Harmony granularity

Harmony is represented by nine bounded structural events:

- pickup dominant degree;
- opening tonic prolongation and half cadence;
- expanded second phrase;
- G-minor/B-flat middle route;
- B-flat arrival;
- D-minor/retransition route;
- tonic return;
- final authentic closure.

Ambiguous diminished and linear passing sonorities are described as connecting events instead of assigning false root certainty to every vertical slice.

## Left-hand texture decision

The score uses `polyphonic-texture`, not `chord-groups`.

The earlier beat-level model produced 95 occurrences and 38 families, dominated by repeated single notes and dyads. That result was rejected because it counted held lower-staff states once per quarter note and treated linear voices as chord collections. The complete harmony is distributed across both staves, so changing the beat window does not create a defensible left-hand chord unit.

The reviewed replacement contains four concrete lower-staff families:

- F bass plus delayed three-beat suspension, including the thinned m9 variant;
- the exact three-measure outer-section voice-leading chain at internal m3–5 and m19–21;
- two related middle-section sequential expansions;
- the unique closing bass descent and final F support.

Occurrence ranges follow complete onset-to-release gestures or multi-measure voice-leading units. No held state is repeated merely because it crosses a beat boundary.

## Cross-validation outcomes

- Confirmed: ternary 8+8+8 organization with six four-measure phrases.
- Rejected: the final eight measures are an exact full-score copy of the opening.
- Qualified: the middle is not one stable modulation; it traverses G minor, B-flat major, and D minor regions before returning.

## Validation commands

```powershell
npm run analysis:chords -- public/analysis/schumann-traumerei-op15-no7.analysis.json
npm run analysis:chords -- --check public/analysis/schumann-traumerei-op15-no7.analysis.json
python .agents/skills/piano-score-analysis/scripts/validate_analysis.py `
  public/analysis/schumann-traumerei-op15-no7.analysis.json `
  --schema analysis/schema/score-analysis.schema.json `
  --source "public/musicxml/Kinderszenen Op. 15 No. 7 - Traumerei.mxl"
```

In polyphonic mode the chord command verifies that chord grouping and chord families are absent; the static texture families are validated through Schema and semantic checks.
