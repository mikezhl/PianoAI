import { describe, expect, it } from "vitest";
import { parseMusicXml } from "./musicXml";

describe("parseMusicXml", () => {
  it("groups chords and keeps backup/forward timing on separate staves", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>Timing Fixture</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <backup><duration>2</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
      <forward><duration>1</duration></forward>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

    const score = parseMusicXml(xml, "timing.musicxml");

    expect(score.title).toBe("timing");
    expect(score.canSeparateHands).toBe(true);
    expect(score.noteGroups.map((group) => ({
      hand: group.hand,
      tick: group.absoluteTick,
      midis: group.notes.map((note) => note.midi),
    }))).toEqual([
      { hand: "right", tick: 0, midis: [60, 64] },
      { hand: "left", tick: 0, midis: [48] },
      { hand: "right", tick: 480, midis: [62] },
      { hand: "left", tick: 960, midis: [55] },
    ]);
  });

  it("keeps tied notes as one practice group with the combined duration", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>1</staves>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>whole</type>
        <tie type="start"/>
        <notations><tied type="start"/></notations>
        <staff>1</staff>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>whole</type>
        <tie type="stop"/>
        <notations><tied type="stop"/></notations>
        <staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const score = parseMusicXml(xml, "tie.musicxml");

    expect(score.noteGroups).toHaveLength(1);
    expect(score.noteGroups[0]).toMatchObject({
      hand: "right",
      absoluteTick: 0,
      durationTicks: 3840,
    });
    expect(score.totalTicks).toBe(3840);
  });

  it("uses actual elapsed duration for pickup measures", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>3</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>3</duration><voice>1</voice><type>half</type></note>
    </measure>
  </part>
</score-partwise>`;

    const score = parseMusicXml(xml, "pickup.musicxml");

    expect(score.measureStarts).toEqual([0, 480]);
    expect(score.measureDurations).toEqual([480, 1440]);
    expect(score.measureTimeSignatures).toEqual([
      { beats: 3, beatType: 4 },
      { beats: 3, beatType: 4 },
    ]);
    expect(score.noteGroups.map((group) => ({
      tick: group.absoluteTick,
      midis: group.notes.map((note) => note.midi),
    }))).toEqual([
      { tick: 0, midis: [64] },
      { tick: 480, midis: [69] },
    ]);
    expect(score.totalTicks).toBe(1920);
  });

  it("tracks the beat unit for each measure across meter changes", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>3</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><rest/><duration>3</duration><voice>1</voice></note>
    </measure>
    <measure number="2">
      <attributes><time><beats>6</beats><beat-type>8</beat-type></time></attributes>
      <note><rest/><duration>3</duration><voice>1</voice></note>
    </measure>
    <measure number="3">
      <attributes><time><beats>6</beats><beat-type>4</beat-type></time></attributes>
      <note><rest/><duration>6</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const score = parseMusicXml(xml, "meter-change.musicxml");
    expect(score.measureDurations).toEqual([1440, 1440, 2880]);
    expect(score.measureTimeSignatures).toEqual([
      { beats: 3, beatType: 4 },
      { beats: 6, beatType: 8 },
      { beats: 6, beatType: 4 },
    ]);
  });

  it("keeps backup alignment after fractional tick durations", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>7</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>7</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>7</duration><voice>5</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

    const score = parseMusicXml(xml, "fractional-backup.musicxml");
    const leftGroup = score.noteGroups.find((group) => group.hand === "left");

    expect(leftGroup?.absoluteTick).toBe(0);
    expect(score.noteGroups.map((group) => group.absoluteTick)).not.toContain(3);
  });

  it("uses the file name without score file extensions as the title", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>Embedded Title Should Not Win</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

    const score = parseMusicXml(xml, "Nocturne Op. 9 No. 2.mxl");

    expect(score.title).toBe("Nocturne Op. 9 No. 2");
  });

  it("normalizes fractional pitch alters to piano semitones", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note>
        <pitch><step>C</step><alter>0.2</alter><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const score = parseMusicXml(xml, "fractional-alter.musicxml");

    expect(score.noteGroups[0].notes[0].midi).toBe(60);
    expect(score.noteGroups[0].notes[0].name).toBe("C4");
  });
});
