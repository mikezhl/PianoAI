import { resolveAppAssetUrl } from "../lib/appUrl";
import type {
  ReferenceInterpretation,
  ReferenceInterpretationCatalog,
  ReferenceInterpretationCatalogEntry,
  ScoreInterpretation,
  ScoreIdentity,
} from "./types";

const REFERENCE_CATALOG_URL = resolveAppAssetUrl("/data/performances/catalog.json");
const REMOTE_REFERENCE_AUDIO_BASE_URL = typeof __REFERENCE_AUDIO_BASE_URL__ === "string"
  ? __REFERENCE_AUDIO_BASE_URL__
  : "";

export function referenceInterpretationUrl(interpretationId: string): string {
  return resolveAppAssetUrl(`/data/performances/interpretations/${encodeURIComponent(interpretationId)}.json`);
}

export function referenceAudioUrl(
  audio: ReferenceInterpretationCatalogEntry["audio"],
  remoteBaseUrl = REMOTE_REFERENCE_AUDIO_BASE_URL,
): string {
  if (!remoteBaseUrl) {
    return resolveAppAssetUrl(`/__reference_audio__/${encodeURIComponent(audio.fileName)}`);
  }
  const encodedObjectKey = audio.objectKey.split("/").map(encodeURIComponent).join("/");
  return `${remoteBaseUrl.replace(/\/+$/, "")}/${encodedObjectKey}`;
}

export async function loadReferenceCatalogEntries(
  score: ScoreIdentity,
  signal?: AbortSignal,
): Promise<ReferenceInterpretationCatalogEntry[]> {
  const response = await fetch(REFERENCE_CATALOG_URL, { signal });
  if (!response.ok) {
    throw new Error(`参考演绎目录加载失败（${response.status}）`);
  }
  const catalog = await response.json() as ReferenceInterpretationCatalog;
  if (catalog.schemaVersion !== "2.1.0" || !Array.isArray(catalog.references)) {
    throw new Error("参考演绎目录格式不受支持");
  }
  return catalog.references.filter((reference) =>
    reference.score.scoreId === score.scoreId
    && reference.score.sourceHash === score.sourceHash,
  );
}

export async function loadReferenceInterpretation(
  reference: ReferenceInterpretationCatalogEntry,
  signal?: AbortSignal,
): Promise<ReferenceInterpretation> {
  const interpretationUrl = referenceInterpretationUrl(reference.interpretationId);
  const response = await fetch(interpretationUrl, { signal });
  if (!response.ok) {
    throw new Error(`参考演绎详情加载失败（${response.status}）`);
  }
  const detail = await response.json() as ScoreInterpretation;
  if (
    detail.schemaVersion !== "2.1.0"
    || detail.interpretationId !== reference.interpretationId
    || detail.score.scoreId !== reference.score.scoreId
    || detail.score.sourceHash !== reference.score.sourceHash
  ) {
    throw new Error("参考演绎详情身份不匹配");
  }
  return {
    ...reference,
    ...detail,
    audio: {
      ...reference.audio,
      url: referenceAudioUrl(reference.audio),
    },
  };
}
