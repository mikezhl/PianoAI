/// <reference types="vite/client" />

declare const __REFERENCE_AUDIO_BASE_URL__: string;

declare module "virtual:musicxml-library" {
  export interface MusicXmlLibraryItem {
    id: string;
    name: string;
    fileName: string;
    url: string;
    scoreId?: string;
    analysisUrl?: string;
    sourceHash?: string;
    canonicalHash: string;
  }

  export const MUSICXML_LIBRARY: MusicXmlLibraryItem[];
}
