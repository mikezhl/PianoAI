# Library Contract

## Two import paths

| Path | Input | Persistence | Capabilities |
| --- | --- | --- | --- |
| Browser practice import | `.musicxml`, `.xml`, `.mxl` | Current browser session | Practice only |
| Built-in library ingestion | Canonical `.mxl` | Git-tracked `data/` | Practice, static analysis, reference performance |

Do not create static analysis for an arbitrary browser import. Static records are tied to reviewed library bytes by SHA-256.

## Owned records

- `data/scores/<score-id>.mxl`: canonical notation source and notation fact authority.
- `.cache/analysis-facts/<score-id>.facts.json`: disposable deterministic inspection output.
- `data/analyses/<score-id>.json`: reviewed Schema 2.1.0 static musical analysis.
- `data/catalog.json`: complete built-in score manifest. Every library MXL must have one validated analysis and one item.
- `data/performances/catalog.json`: optional reference recordings tied to the same `scoreId` and `sourceHash`.

## Identity rules

- Use one lowercase kebab-case `scoreId` for source, analysis, catalog, and performance foreign keys.
- Use the SHA-256 of the exact MXL file bytes as `sourceHash`.
- Treat a changed source hash as an incompatible score revision for every alignment record.
- Keep display measure numbers separate from zero-based internal `measureIndex` values.
- Never persist parser-temporary note IDs as cross-version identities.

## Ownership boundaries

- Deterministic inspection establishes notation facts, not form or motif interpretation.
- `$piano-score-analysis` owns sections, motifs, harmonic/texture interpretation, evidence, and cross-validation.
- `$piano-reference-performance` owns professional recording source identity, transcription, alignment, evaluation, and interpretation data.
