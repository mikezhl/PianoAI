# Left-Hand Analysis Conventions

## Decide the model first

The left-hand layer must describe a musically defensible unit, not force every lower-staff passage into a chord vocabulary.

Choose exactly one mode:

- `chord-groups`: repeated metrical accompaniment groups whose notes jointly express a chord or stable accompaniment unit;
- `polyphonic-texture`: bass, inner voices, suspensions, and linear motion whose useful units extend across attacks or beats.

Use score evidence, texture, voice independence, duration, and repetition. Do not select a mode from the title or composer.

Warning signs that `chord-groups` is wrong:

- single-note and dyad families dominate the vocabulary;
- one held sonority is counted again on every beat;
- changing the beat size radically changes the supposed chord identity;
- the complete harmony is distributed across both staves;
- notes collected within one window do not sound simultaneously and form a linear voice instead.

## Chord-group mode

Set `leftHandChordGrouping` before generation:

- `meter-beat`: use the compound beat when the numerator is greater than three and divisible by three; otherwise use the notated beat;
- `notated-beat`: always use the denominator unit;
- `measure`: aggregate one complete accompaniment cell, such as bass plus two upper attacks in a normal waltz;
- `overrides`: replace the default for reviewed, ordered, non-overlapping measure ranges.

Aggregate notes sounding within the group only after confirming that the window represents one accompaniment unit. Include tied notes that remain part of that unit. Preserve spelling, bass, voicing, and occurrence locations. A single note or dyad is valid only when it is independently meaningful, not merely the residue of sparse voices.

## Polyphonic-texture mode

Set `leftHandChordGrouping` to `null` and `leftHandChordFamilies` to an empty array. Author `leftHandTextureFamilies` from the exact score.

Useful family roles:

- `bass-framework`: recurring bass entries, pedals, routes, or structural returns;
- `sustained-interval`: delayed upper entry, suspension, or held interval treated as one onset-to-release event;
- `voice-leading`: multi-onset lower-staff chain whose contour and resolution matter more than vertical labels;
- `closing-gesture`: unique but practice-relevant closing bass and inner-voice path.

Each family must state recognition evidence, understanding or practice value, and ordered occurrences. Merge one sustained state into one occurrence. Use `exact` only for deterministic equality; use `near-exact` or `varied` when notes, rhythm, register, or exit differ.

The lower staff is score notation, not guaranteed physical fingering. Do not claim a complete chord or physical left-hand assignment when cross-staff voices make that uncertain.

## Audit checks

- The selected mode explains the texture throughout every included occurrence.
- Chord generation is deterministic and unchanged for other `chord-groups` scores.
- Polyphonic families do not duplicate generic form or motif prose; they expose concrete lower-staff material.
- Occurrence ranges follow actual musical units rather than arbitrary beat windows.
- Sparse engraved anchors, leading rests, long sustains, pickups, and system breaks render with non-zero, ordered widths.
