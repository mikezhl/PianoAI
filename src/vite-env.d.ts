/// <reference types="vite/client" />

declare module "virtual:musicxml-library" {
  export interface MusicXmlLibraryItem {
    id: string;
    name: string;
    fileName: string;
    url: string;
  }

  export const MUSICXML_LIBRARY: MusicXmlLibraryItem[];
}
