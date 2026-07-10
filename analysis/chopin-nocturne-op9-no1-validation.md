# Chopin · Nocturne Op. 9 No. 1 · Validation

## Source identity

- Library file: `Nocturne Op. 9 No. 1.mxl`
- SHA-256: `66CF22D69119653984E2ED3993C9C475043C43BC7033301A82AF037237CD5809`
- Internal measures: 86
- Complete notated measures: 85
- Meter: 6/4
- Key: B-flat minor, explicitly encoded in MusicXML.
- Pickup: internal measure 0 contains three quarter notes and no left-hand onset.

## Form and section hierarchy

The top level is an expanded ternary form `A-B-A'-Coda`, consistent with independent discussions of Op. 9 No. 1. The analysis does not stop at that label:

- A contains an eight-measure first statement and a ten-measure expanded statement.
- B contains two sixteen-measure periodic blocks, a sixteen-measure D-flat/A-flat pedal field, and a four-measure retransition.
- A' returns at internal m71, reuses a long left-hand block, and compresses the ending.
- The final three measures form a Picardy-third coda.

## Deterministic repetition evidence

- Full score m19-21 repeats at m27-29.
- Full score m23-25 repeats at m31-33.
- Right hand m31-42 repeats at m39-50, a twelve-measure exact span produced by an eight-measure periodic overlap.
- Left hand m32-37 repeats at m40-45.
- Left hand m9-15 repeats at m71-77, confirming the thematic return while the right hand remains varied.

These results justify period families and reusable practice blocks without claiming that whole sections are exact copies.

## Pedal-field decision

Internal m51-66 is separated from the preceding periodic sequence because:

- the left hand remains on D-flat/A-flat for an extended span;
- m59-60 contains no new right-hand onset;
- m61 restarts a similar right-hand wave over the same pedal;
- m67 changes to three discrete chordal calls.

This distinction is important for practice: the pedal field requires long-range voicing and dynamic control, not repeated accompaniment fingering.

## Motif-family decisions

1. `motif-a-cantilena`: three A-theme statements, compared through melodic support points, decoration density, length, and cadence.
2. `motif-middle-cycle`: four eight-measure periodic units in the first half of B.
3. `motif-pedal-wave`: two right-hand waves over the D-flat/A-flat pedal.
4. `motif-retransition-call`: three chordal calls before the return.

## Tonal interpretation boundary

Tonal direction is described only where it helps explain a section or motif. The analysis does not assign a speculative Roman numeral to every chromatic verticality. Remote D/F-sharp and augmented/diminished sonorities are therefore described as coloristic sequence or linear voice-leading when a single root interpretation is not stable.

## Left-hand vocabulary

The duration-aware generator produced:

- 169 compound-beat accompaniment groups;
- 40 spelling-aware pitch-class families.

This score's `6/4` is compound duple: each complete measure is divided into two three-quarter groups. Every group aggregates the complete arpeggio, including sustained notes, before chord naming. The opening theme now resolves to meaningful families such as B-flat minor, D-flat major, G-flat major, F7, and literal chromatic collections instead of six unrelated single-note or dyad fragments per measure.

The long D-flat/A-flat pedal field remains a literal dyad where the complete left-hand grouping window contains only those two pitch classes; it is no longer inflated to 163 quarter-beat fragments.

## Cross-validation outcomes

- Confirmed: expanded ternary A-B-A'.
- Rejected: the middle is through-composed without periodic reuse.
- Rejected: m51 continues the prior cycle unchanged.
- Rejected: decoration is dispensable surface detail.
- Rejected: the final tonic remains minor; the score ends B-flat major.

## Validation commands

```powershell
npm run analysis:chords -- public/analysis/chopin-nocturne-op9-no1.analysis.json
npm run analysis:chords -- --check public/analysis/chopin-nocturne-op9-no1.analysis.json
python .agents/skills/piano-score-analysis/scripts/validate_analysis.py `
  public/analysis/chopin-nocturne-op9-no1.analysis.json `
  --schema analysis/schema/score-analysis.schema.json `
  --source "public/musicxml/Nocturne Op. 9 No. 1.mxl"
```
