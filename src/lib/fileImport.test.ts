import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { readScoreXmlFromFile, readScoreXmlFromUrl } from "./fileImport";

const SCORE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>Import Fixture</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>
  </rootfiles>
</container>`;

async function buildMxlBytes(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("score.musicxml", SCORE_XML);
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("score file import", () => {
  it("extracts MusicXML from an MXL file", async () => {
    const file = new File([await buildMxlBytes()], "fixture.mxl");

    const xml = await readScoreXmlFromFile(file);

    expect(xml).toContain("<work-title>Import Fixture</work-title>");
  });

  it("extracts MusicXML from a library MXL URL", async () => {
    const bytes = await buildMxlBytes();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes.slice(0), { status: 200 })),
    );

    try {
      const xml = await readScoreXmlFromUrl("/musicxml/fixture.mxl", "fixture.mxl");

      expect(fetch).toHaveBeenCalledWith("/musicxml/fixture.mxl");
      expect(xml).toContain("<work-title>Import Fixture</work-title>");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
