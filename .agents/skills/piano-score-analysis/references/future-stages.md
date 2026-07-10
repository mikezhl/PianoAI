# Future Performance Stages

## Contract Separation

Keep these versioned contracts independent:

1. `ScoreAnalysis`: static form, motif, and texture-aware left-hand analysis.
2. `PerformanceTake`: raw reference-pianist or user MIDI/audio input plus provenance.
3. `ScoreAlignment`: mappings from performance events to stable score-note or `ScoreRange` references.
4. `PerformanceAnalysis`: measured tempo, timing, duration, velocity, balance, articulation, and pedal features with confidence.
5. `PracticeAssessment`: evidence-backed user issues, priorities, trends, and suggestions.

Do not place performance timing or advice in score-analysis Schema 2.1.0.

## Stable Score Note Identity

The runtime parser's `n-*` IDs depend on traversal order and are not persistent identifiers. Define a separate `ScoreNoteRef` before phase two. It should contain:

- `measureIndex`;
- rational quarter-note offset;
- part when multiple parts exist;
- staff and voice;
- written pitch including spelling and octave;
- an ordinal for simultaneous duplicate notes.

Every alignment also stores `scoreId` and `sourceHash`. A changed source hash invalidates the old alignment until it is explicitly migrated or recomputed.

## Phase Two: Reference Audio

- Prefer score-informed transcription and alignment over reconstructing the score from audio alone.
- Preserve transcription and alignment confidence separately.
- Keep raw model candidates so a better aligner can be rerun without losing the original take.
- Compare at least two transcription approaches on a small benchmark from the current five pieces before selecting the production baseline.
- Treat pianist recordings as examples of expressive choices, not canonical answers.

## Phase Three: User Assessment

- Prefer MIDI note-on, note-off, velocity, and CC64 when available; use the audio pipeline as fallback.
- Compute errors and expressive metrics deterministically before asking a model to explain them.
- Every suggestion cites a score location, metric, observed value, comparison basis, confidence, and historical trend when available.
- Separate likely mistakes, stylistic choices, and uncertain recognition.
- Reference and user takes may share feature schemas, but keep their roles explicit so one pianist is never treated as the only correct interpretation.
