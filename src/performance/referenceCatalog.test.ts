import { describe, expect, it, vi } from "vitest";
import { loadReferenceCatalogEntries, loadReferenceInterpretation, referenceAudioUrl } from "./referenceCatalog";
import type { ReferenceInterpretationCatalogEntry, ScoreInterpretation } from "./types";

const scoreIdentity = { scoreId: "score", sourceHash: "hash", identitySource: "library-source" as const };
const catalogReference = {
  interpretationId: "reference",
  score: scoreIdentity,
  performerId: "performer",
  performerName: "Pianist",
  evidenceId: "audio",
  source: { title: "source", url: "https://example.com", kind: "original-recording" },
  audio: { fileName: "reference.m4a", objectKey: `reference-audio/${"a".repeat(64)}.m4a`, sha256: "hash", durationUs: 5_000_000, format: "audio/mp4", sampleRate: 48000, channels: 2, storage: "cloudflare-r2" },
} satisfies ReferenceInterpretationCatalogEntry;
const detail = {
  schemaVersion: "2.1.0",
  interpretationId: "reference",
  score: scoreIdentity,
  timeMap: [
    { scorePosition: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } }, timeUs: 100_000, confidence: 0.9 },
    { scorePosition: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } }, timeUs: 1_000_000, confidence: 0.82 },
    { scorePosition: { measureIndex: 2, offsetQuarter: { numerator: 0, denominator: 1 } }, timeUs: 2_000_000, confidence: 0.8 },
  ],
  noteExpressions: [{
    scoreNoteRef: { partId: "P1", measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 }, staff: 1, voice: "1", writtenPitch: "C4", ordinalAtPosition: 0 },
    kind: "performed",
    onsetUs: 100_000,
    releaseUs: 500_000,
    intensity: 0.5,
    confidence: 0.9,
  }],
  pedals: { sustain: [] },
  generation: {
    status: "automatically-validated",
    algorithmVersion: "test",
    validationPolicyVersion: "test",
    models: ["test"],
    evaluationId: "reference",
    evaluationSha256: `sha256:${"A".repeat(64)}`,
    dimensions: { pitch: 0.9, "note-onset": 0.9 },
    coverage: { scoreNotes: 1, matchedNotes: 1, ornamentGestures: 0, uncertainNotes: 0, extraEvents: 0, scoreCoverage: 1, performanceCoverage: 1 },
  },
} satisfies ScoreInterpretation;

describe("reference catalog", () => {
  it("loads the lightweight catalog before the selected interpretation detail", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: "2.1.0", references: [catalogReference] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 200 })));
    try {
      const entries = await loadReferenceCatalogEntries(scoreIdentity);
      expect(entries).toHaveLength(1);
      expect(entries[0].performerName).toBe("Pianist");
      expect(fetch).toHaveBeenCalledTimes(1);

      const loaded = await loadReferenceInterpretation(entries[0]);
      expect(loaded.noteExpressions[0].onsetUs).toBe(100_000);
      expect(loaded.performerName).toBe("Pianist");
      expect(loaded.timeMap).toHaveLength(3);
      expect(loaded.audio.url).toBe("/__reference_audio__/reference.m4a");
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resolves content-addressed R2 object URLs for online builds", () => {
    expect(referenceAudioUrl(catalogReference.audio, "https://media.example.com/root/"))
      .toBe(`https://media.example.com/root/reference-audio/${"a".repeat(64)}.m4a`);
  });
});
