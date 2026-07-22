import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { parseMusicXml } from "../../src/lib/musicXml";
import type { ScoreData } from "../../src/types";

export async function loadCanonicalScore(filePath: string): Promise<ScoreData> {
  const fileName = path.basename(filePath);
  let xml: string;
  if (fileName.toLowerCase().endsWith(".mxl")) {
    const archive = await JSZip.loadAsync(readFileSync(filePath));
    const container = archive.file("META-INF/container.xml");
    const containerXml = container ? await container.async("string") : "";
    const rootPath = /full-path=["']([^"']+)["']/.exec(containerXml)?.[1]
      ?? Object.keys(archive.files).find((entry) =>
        entry.toLowerCase().endsWith(".xml") && entry.toLowerCase() !== "meta-inf/container.xml");
    if (!rootPath || !archive.file(rootPath)) throw new Error(`MXL score XML missing: ${filePath}`);
    xml = await archive.file(rootPath)!.async("string");
  } else {
    xml = readFileSync(filePath, "utf8");
  }
  const dom = new JSDOM("");
  Object.assign(globalThis, { DOMParser: dom.window.DOMParser });
  return parseMusicXml(xml, fileName);
}
