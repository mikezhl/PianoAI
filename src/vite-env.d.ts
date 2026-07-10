/// <reference types="vite/client" />

declare module "virtual:musicxml-library" {
  export interface MusicXmlLibraryItem {
    id: string;
    name: string;
    fileName: string;
    url: string;
    scoreId?: string;
    analysisUrl?: string;
    sourceHash?: string;
  }

  export const MUSICXML_LIBRARY: MusicXmlLibraryItem[];
}
