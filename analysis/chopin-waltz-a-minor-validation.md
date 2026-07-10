# Chopin · Waltz in A Minor B. 150 · Validation

## Source identity

- Library file: `Waltz in A Minor.mxl`
- SHA-256: `B21513E649C021B25F2E87677C691843B050F9B1CD318BC8118CB3441917F1FE`
- Internal measures: 57
- Complete notated measures: 56
- Meter: 3/4
- Key: A minor. The MusicXML contains a zero-fifths signature without `<mode>`; A minor is established from the work identity, repeated Am/E7 functions, and final tonic rather than inferred as C major.
- Pickup: internal measure 0 is one quarter; internal measure 56 completes the ending.

## Independent form decision

The analysis uses `A-A'-B-A'-C-A-Coda`, not a generic ABA label.

- Internal m1-7 and m41-47 are exact full-score repeats.
- Internal m9-14 and m25-30 are exact full-score repeats.
- m17-24 is a distinct E7-Am dominant-tonic block.
- m33-40 establishes a parallel-major A-major contrast.
- m53-56 is a four-measure coda with new inversion/predominant material.

This form records which theme block returns and where its ending changes.

## Harmonic anchors

1. Opening turnaround: `Am-Dm-G7-C`.
2. B section: four two-measure `E7-Am` tension-release units.
3. Modulation: B7 functions as V/V before an extended E7 resolves to A major.
4. Coda: `Am/C-Dm6-E7-Am`.

These anchors are independently described by Italian Piano and are confirmed against the current MusicXML pitches and bass notes.

## Motif-family decisions

- `motif-turnaround-theme` groups five structurally related returns. Exact repeated blocks are identified explicitly; changed endings are not called exact.
- `motif-dominant-tonic` divides the eight-measure B section into four comparable two-measure units.
- `motif-major-contrast` compares the two four-measure A-major phrases.

The result supports memory by separating reusable blocks from the short transition exits that need independent practice.

## Left-hand vocabulary

The duration-aware generator produced:

- 56 measure-level accompaniment groups;
- 11 spelling-aware pitch-class families.

The opening pickup has no left-hand event. Each complete 3/4 measure uses `measure` grouping so the bass and the repeated second- and third-beat attacks form one accompaniment chord. This removes the misleading split between high-frequency single-bass families and their upper chord shapes: the opening now reads as complete Am, Dm, G7-type, and C groups.

## Cross-validation outcomes

- Rejected: unchanged ABA.
- Confirmed: opening `Am-Dm-G7-C` turnaround.
- Confirmed: repeated `E7-Am` tension-release block.
- Rejected: A-major section and coda are merely surface ornamentation.

## Validation commands

```powershell
npm run analysis:chords -- public/analysis/chopin-waltz-a-minor.analysis.json
npm run analysis:chords -- --check public/analysis/chopin-waltz-a-minor.analysis.json
python .agents/skills/piano-score-analysis/scripts/validate_analysis.py `
  public/analysis/chopin-waltz-a-minor.analysis.json `
  --schema analysis/schema/score-analysis.schema.json `
  --source "public/musicxml/Waltz in A Minor.mxl"
```
