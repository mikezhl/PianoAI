import { describe, expect, it, vi } from "vitest";
import { prepareMusicXmlForAnalysisDisplay, prepareMusicXmlForPracticeDisplay } from "./displayXml";

describe("prepareMusicXmlForPracticeDisplay", () => {
  it("normalizes fractional pitch alters for notation rendering", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <note>
        <pitch><step>C</step><alter>0.2</alter><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const prepared = prepareMusicXmlForPracticeDisplay(xml);

    expect(prepared.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>")).toBe(true);
    expect(prepared.match(/<\?xml/g)).toHaveLength(1);
    expect(prepared).toContain("<alter>0</alter>");
    expect(prepared).not.toContain("<alter>0.2</alter>");
  });

  it("does not duplicate an XML declaration kept by the browser serializer", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1"/></part>
</score-partwise>`;
    const OriginalXMLSerializer = XMLSerializer;

    class BrowserLikeXMLSerializer extends OriginalXMLSerializer {
      serializeToString(rootNode: Node): string {
        return `<?xml version="1.0" encoding="UTF-8"?>${super.serializeToString(rootNode)}`;
      }
    }

    vi.stubGlobal("XMLSerializer", BrowserLikeXMLSerializer);
    try {
      const prepared = prepareMusicXmlForPracticeDisplay(xml);

      expect(prepared.match(/<\?xml/g)).toHaveLength(1);
      expect(new DOMParser().parseFromString(prepared, "application/xml").documentElement.localName).toBe(
        "score-partwise",
      );
    } finally {
      vi.stubGlobal("XMLSerializer", OriginalXMLSerializer);
    }
  });
});

describe("prepareMusicXmlForAnalysisDisplay", () => {
  it("preserves source fingerings for score study", () => {
    const xml = `<?xml version="1.0"?><score-partwise><part><measure><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><notations><technical><fingering>3</fingering></technical></notations></note></measure></part></score-partwise>`;
    const result = prepareMusicXmlForAnalysisDisplay(xml);
    const doc = new DOMParser().parseFromString(result, "application/xml");
    expect(doc.getElementsByTagName("fingering")[0]?.textContent).toBe("3");
  });
});
