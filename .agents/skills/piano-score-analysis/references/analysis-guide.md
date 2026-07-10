# Analysis Guide

## Evidence Layers

Use four distinct evidence layers:

1. **Source facts**: notes, spelling, rhythm, voices, staff, dynamics, articulations, tempo, fingering, pedal, repeats, measure map.
2. **Deterministic results**: exact note equality, normalized rhythm or interval similarity, bass-line equality, texture density, register, duration, repeated harmonic skeletons.
3. **External claims**: academic writing, annotated analyses, pedagogical commentary, reputable secondary sources.
4. **Interpretation**: form labels, motif roles, tonal direction, and expressive meaning.

Never present layers 3 or 4 as layer 1.

## Analysis Order

### 1. Establish Coordinates

- Hash the exact source file.
- Preserve internal MusicXML measure order.
- Build `measureNumberByIndex`; repeated displayed numbers are valid.
- Detect pickups and split written measures before analysis.
- Use `pickupMeasureIndex: null` when the score starts with a complete measure; do not label measure 0 as a pickup by default.
- Use internal indices for JSON and displayed labels only for UI text.

### 2. Segment Form

- First identify cadence, texture, thematic, dynamic, and register boundaries.
- Build a complete ordered section map.
- Choose one practical primary form label for navigation.
- Keep credible alternatives in cross-validation notes.
- Avoid multiplying sections when a change is only ornamental.

### 3. Group Motifs And Themes

For each family, record:

- a representative occurrence;
- recognition features that survive variation;
- every occurrence range;
- relation type and local differences;
- why the family matters structurally or perceptually.

Distinguish:

- `representative`: the reference occurrence for the family;
- `exact`: same relevant musical content;
- `near-exact`: small local differences with the same phrase identity;
- `ornamented`: stable skeleton with added or redistributed decoration;
- `transposed`: identity retained at another pitch level;
- `rhythmic-variant`: identity retained with a changed rhythmic profile;
- `fragmented`: partial reuse;
- `extended`: the family is prolonged beyond the reference span;
- `intensified`: denser, stronger, or registrally expanded reuse;
- `other`: another clearly explained relation that does not fit the named values.

Contrasting material belongs in a separate family. Do not write relation values that are absent from the Schema enum.

Do not use a high scalar similarity score as the sole proof of thematic identity.

Do not create a second similar-passage collection. Represent useful comparisons through motif families, and record the shared recognition basis plus occurrence-level differences there.

### 4. Build Texture-Aware Left-Hand Analysis

- Decide `leftHandAnalysisMode` before generation. The decision comes from the score's texture, not the title.
- Use `chord-groups` only when one reviewed metrical window forms a stable accompaniment unit. Then set `leftHandChordGrouping`, preserve written spelling, and distinguish exact voicing, changed register, and changed bass.
- Segment compound meters by compound beat when the arpeggio belongs to one chord group. Use whole-measure grouping for a waltz bass plus its upper attacks when they form one accompaniment cell.
- Do not preserve a held lower-staff state as a new occurrence on every beat unless each beat is genuinely a new accompaniment group.
- Switch to `polyphonic-texture` when bass, inner voices, suspensions, and sequential lines are the meaningful units or when complete harmony is distributed across both staves.
- In polyphonic mode, set grouping to `null`, keep chord families empty, and author bass frameworks, sustained intervals, voice-leading chains, and closing gestures from exact score evidence.
- Treat one sustained state as one onset-to-release occurrence. Use deterministic equality for `exact`; document local changes for `near-exact` and `varied`.
- Store every occurrence in JSON before the app runs. The frontend only visualizes reviewed results and never chooses the analysis mode at runtime.

### 5. Cross-Validate

For each important disputed or externally supported claim:

- quote the claim in your own concise words;
- record concrete score evidence;
- list source IDs;
- mark it `confirmed`, `qualified`, or `rejected`;
- state the adopted conclusion and why.

Reject online claims that conflict with the source score. Qualify claims whose terminology is plausible but not uniquely determined.

## Op. 9 No. 2 Proven Example

The validated reference demonstrates these decisions:

- `A–A′–B–A″–B′–A‴–Coda` is useful for navigation while other formal labels remain alternatives.
- m9–12 and m17–20 have an exactly repeated left hand, but the complete passages are not described as fully identical.
- the A family retains harmony, bass, and melodic skeleton while ornamentation expands;
- m4, m8, m16, and m24 belong to one cadence family but are not exact copies;
- the B section is described as strengthened subdominant-region activity, not a forced stable modulation;
- m32 is an expanded dominant cadenza, not a sequence of invented note-level chords.

Use these as reasoning examples, not as templates for unrelated pieces.

## Generalization Checks

Before accepting a new analysis, compare it against at least one unlike proven piece:

- If every score receives four-measure A variants, the method is overfit to Op. 9 No. 2.
- If a polyphonic score produces mostly single notes or dyads, inspect sustained-note handling and cross-staff distribution before changing labels.
- If a long score appears through-composed, inspect exact repeated sequences and tempo/key blocks for larger reusable modules.
- If the key signature omits mode, do not default to the relative major.
- If an exact sequence crosses a tempo or section boundary, inspect whether the shared measure is a cadence, pickup, or shared boundary before assigning ranges.
