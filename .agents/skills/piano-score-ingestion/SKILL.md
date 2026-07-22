---
name: piano-score-ingestion
description: Import and register canonical PianoAI library scores from MusicXML or MXL sources, establish stable score identity, extract deterministic facts, and hand off to static score analysis. Use when Codex needs to add or replace a built-in score, distinguish temporary browser import from library ingestion, verify a migrated score source, or prepare a score for the piano-score-analysis workflow.
---

# Piano Score Ingestion

Create one stable, reviewable library source before any musical interpretation. Treat browser import and repository ingestion as different workflows.

## Required order

1. Read `references/library-contract.md`.
2. Decide the target:
   - For one-session practice with a user-selected `.musicxml`, `.xml`, or `.mxl`, use the app import flow. Do not create catalog or analysis records.
   - For a built-in score with static analysis or reference performances, continue with repository ingestion.
3. Inspect the incoming file before copying it:

```powershell
npm run analysis:inspect -- "<incoming-score>" `
  --output ".cache/analysis-facts/<candidate-id>.incoming.json"
```

4. Confirm that the file opens, contains the intended complete piano work, uses the expected title/composer, and has plausible measure, meter, key, tempo, part, and range facts. Reject excerpts, duplicate movements, corrupt containers, and ambiguous editions until resolved.
5. Choose a stable lowercase kebab-case `scoreId`. Search `data/catalog.json`, `data/scores/`, `data/analyses/`, `data/performances/catalog.json`, and source plans before accepting it.
6. Preserve provenance in the task notes. Record where the file came from, the edition or uploader when known, and any transformations. Never claim a raw XML file is an MXL file by renaming its extension.
7. Store the canonical built-in source as `data/scores/<score-id>.mxl`. The current build contract supports MXL for library scores. Convert raw MusicXML with a trusted notation tool, reopen the produced MXL, and retain the original provenance outside runtime data.
8. Generate facts from the exact stored bytes:

```powershell
npm run analysis:inspect -- "data/scores/<score-id>.mxl" `
  --output ".cache/analysis-facts/<score-id>.facts.json"
```

9. Confirm the fact `sourceHash` and all structural facts changed only as expected. Treat this hash as the score identity used by analysis and performance data.
10. Use `$piano-score-analysis` to author and validate `data/analyses/<score-id>.json`. Do not add a partial catalog entry to make incomplete validation pass.
11. Add the final `data/catalog.json` item only after the single analysis validates. Copy `scoreId`, title, and `sourceHash` from the reviewed analysis.
12. Run the completion gate:

```powershell
npm run analysis:validate
npm test -- --run
npm run build:local
```

13. Verify the built-in score in practice and analysis modes on desktop and `390x844`. Check score load, layout, selection, playback, section navigation, motif navigation, and left-hand navigation.

## Change control

- Treat replacement bytes as a new score revision even when the filename is unchanged.
- Regenerate the analysis facts and update every matching `sourceHash` in analysis, catalog, and performance references together.
- Do not reuse old performance alignment against a changed score hash.
- Do not commit `.cache`, `.local`, or local reference audio.
- Keep deterministic facts separate from musical interpretation.

## Completion gate

Complete ingestion only when the exact stored MXL is the intended source, facts are reviewable, analysis validation passes, catalog coverage is complete, and the real application renders the built-in score correctly.
