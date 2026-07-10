# Chopin · Waltz in C-sharp Minor Op. 64 No. 2 · Validation

## Source identity

- Library file: `Waltz in C# Minor.mxl`
- SHA-256: `29767F6FF672D4FE9EA3636C9E2D5A29ACEAA4DB03D2AFDC467CE412E594A672`
- Internal measures: 194
- Complete notated measures: 193
- Meter: 3/4
- Opening key signature: four sharps with no `<mode>` field. C-sharp minor is confirmed from the work identity, tonic/dominant behavior, and score pitches.
- Key changes: five flats at internal m65; four sharps return at m98.
- Tempo changes: 110 at m0, 180 at m33, 100 at m65, 180 at m98, 110 at m129, 180 at m162.

## Form decision

The analysis uses `A-B-C-B'-A'-B''`, matching the six tempo blocks and the established rondo layout.

- A: Tempo giusto, chordal/walking theme.
- B: Più mosso, running eighth-note theme in two sixteen-measure periods.
- C: Più lento, D-flat-major sostenuto interlude.
- The remaining B-A-B order is confirmed both by tempo/key restoration and exact score repetition.

The final B is not relabeled as a long new coda because nearly all of its material is reused; only its closing function changes.

## Deterministic repetition evidence

- Full score m1-16 repeats at m130-145.
- Full score m33-48 repeats at m114-129 and m162-177.
- Full score m34-49 repeats at m99-114.
- Full score m33-47 repeats at m49-63 and m178-192.
- Several additional sixteen-measure B alignments confirm that the apparent 194-measure scale is built from a small number of reusable modules.

## Motif-family decisions

1. `motif-a-walking-theme`: four sixteen-measure A half-sections. The returning first half is exact; the returning second half has a changed exit.
2. `motif-b-running-theme`: six sixteen-measure fast periods, with exact and near-exact relations recorded per occurrence.
3. `motif-c-sostenuto`: two related D-flat-major half-sections.

This organization is intentionally memory-oriented: it exposes exact reusable modules and isolates only the endings that require separate practice.

## Tonal cross-check

The Più lento section is D-flat major, not merely a slower C-sharp-minor passage:

- the key signature changes from four sharps to five flats;
- the opening sonority contains D-flat, F, and A-flat;
- independent form descriptions identify the section as the enharmonic parallel major;
- the score restores four sharps with the return of B.

## Left-hand vocabulary

The duration-aware generator produced:

- 181 measure-level accompaniment groups;
- 42 spelling-aware pitch-class families.

The default `measure` grouping joins each waltz bass with its upper attacks instead of treating the three beats as unrelated families. Measures with chromatic voice motion remain literal multi-pitch collections rather than being forced into unstable chord names. Enharmonic spellings remain separate across C-sharp-minor and D-flat-major sections so C-sharp and D-flat functions are not silently merged.

## Cross-validation outcomes

- Confirmed: A-B-C-B-A-B rondo layout.
- Rejected: each B is newly composed.
- Rejected: C remains in C-sharp minor.
- Qualified: A' is exact in its first half and varied in its second.
- Rejected: the final B is a wholly new coda.

## Validation commands

```powershell
npm run analysis:chords -- public/analysis/chopin-waltz-c-sharp-minor.analysis.json
npm run analysis:chords -- --check public/analysis/chopin-waltz-c-sharp-minor.analysis.json
python .agents/skills/piano-score-analysis/scripts/validate_analysis.py `
  public/analysis/chopin-waltz-c-sharp-minor.analysis.json `
  --schema analysis/schema/score-analysis.schema.json `
  --source "public/musicxml/Waltz in C# Minor.mxl"
```
