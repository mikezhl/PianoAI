function elementsByLocalName(doc: Document, localName: string): Element[] {
  return Array.from(doc.getElementsByTagNameNS("*", localName));
}

function directChildren(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter((child) => child.localName === localName);
}

function directChild(parent: Element, localName: string): Element | null {
  return directChildren(parent, localName)[0] ?? null;
}

function childText(parent: Element, localName: string): string | null {
  return directChild(parent, localName)?.textContent?.trim() ?? null;
}

function removeEmptyElements(doc: Document, localName: string): void {
  for (const element of elementsByLocalName(doc, localName)) {
    if (element.children.length === 0 && element.textContent?.trim() === "") {
      element.remove();
    }
  }
}

function removeDirectionsWithoutTypes(doc: Document): void {
  for (const direction of elementsByLocalName(doc, "direction")) {
    if (directChildren(direction, "direction-type").length === 0) {
      direction.remove();
    }
  }
}

function normalizePitchAlters(doc: Document): void {
  for (const pitch of elementsByLocalName(doc, "pitch")) {
    const alter = directChild(pitch, "alter");
    if (!alter) {
      continue;
    }

    const parsed = Number.parseFloat(alter.textContent?.trim() ?? "");
    if (Number.isFinite(parsed)) {
      alter.textContent = String(Math.round(parsed));
    }
  }
}

function partHasGrandStaff(part: Element): boolean {
  return directChildren(part, "measure").some((measure) => {
    const attributes = directChild(measure, "attributes");
    const staves = attributes ? Number.parseInt(childText(attributes, "staves") ?? "", 10) : Number.NaN;
    return Number.isFinite(staves) && staves >= 2;
  });
}

function setDirectionStaff(direction: Element, staffNumber: string): void {
  let staff = directChild(direction, "staff");
  if (!staff) {
    staff = direction.ownerDocument.createElement("staff");
    direction.append(staff);
  }
  staff.textContent = staffNumber;
}

function normalizeGrandStaffPedals(doc: Document): void {
  for (const part of elementsByLocalName(doc, "part")) {
    if (!partHasGrandStaff(part)) {
      continue;
    }

    for (const direction of Array.from(part.getElementsByTagNameNS("*", "direction"))) {
      const pedals = directChildren(direction, "direction-type").flatMap((directionType) =>
        directChildren(directionType, "pedal"),
      );
      if (pedals.length === 0) {
        continue;
      }

      const staff = childText(direction, "staff");
      if (!staff || staff === "1") {
        setDirectionStaff(direction, "2");
      }

      for (const pedal of pedals) {
        pedal.removeAttribute("default-y");
        pedal.removeAttribute("relative-y");
      }
    }
  }
}

const SMUFL_ACCIDENTAL_WORDS: Record<string, { musicXml: string; fallback: string }> = {
  "\uE260": { musicXml: "flat", fallback: "\u266D" },
  "\uE261": { musicXml: "natural", fallback: "\u266E" },
  "\uE262": { musicXml: "sharp", fallback: "\u266F" },
  "\uE263": { musicXml: "double-sharp", fallback: "\uD834\uDD2A" },
  "\uE264": { musicXml: "flat-flat", fallback: "\uD834\uDD2B" },
};

const PRIVATE_USE_RE = /[\uE000-\uF8FF]/;

interface PendingOrnamentAccidental {
  word: Element;
  musicXml: string;
  fallback: string;
  y: number;
  placement: "above" | "below";
}

function firstFontFamily(fontFamily: string | null): string | null {
  const family = fontFamily?.split(",")[0]?.trim();
  return family ? family.replace(/^["']|["']$/g, "") : null;
}

function cssFamily(fontFamily: string): string {
  return fontFamily
    .split(",")
    .map((family) => {
      const trimmed = family.trim();
      if (trimmed.startsWith("\"") || trimmed.startsWith("'")) {
        return trimmed;
      }
      return `"${trimmed.replace(/"/g, "\\\"")}"`;
    })
    .join(", ");
}

function canLikelyRenderDeclaredFont(fontFamily: string | null, text: string): boolean {
  const family = firstFontFamily(fontFamily);
  if (!family || typeof document === "undefined") {
    return false;
  }

  const fontSpec = `16px ${cssFamily(family)}`;
  if (document.fonts && !document.fonts.check(fontSpec, text)) {
    return false;
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return false;
  }

  context.font = `${fontSpec}, monospace`;
  const declaredWidth = context.measureText(text).width;
  context.font = "16px monospace";
  const fallbackWidth = context.measureText(text).width;

  return declaredWidth !== fallbackWidth;
}

function getNumericAttribute(element: Element, attribute: string): number | null {
  const value = element.getAttribute(attribute);
  if (value == null) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getWordY(word: Element): number {
  return getNumericAttribute(word, "relative-y") ?? getNumericAttribute(word, "default-y") ?? 0;
}

function getWordPlacement(word: Element): "above" | "below" {
  const y = getWordY(word);
  if (y !== 0) {
    return y > 0 ? "above" : "below";
  }

  const direction = word.closest("direction");
  return direction?.getAttribute("placement") === "below" ? "below" : "above";
}

function getSmuflAccidentalWord(word: Element): PendingOrnamentAccidental | null {
  const text = word.textContent?.trim();
  if (!text || Array.from(text).length !== 1) {
    return null;
  }

  const accidental = SMUFL_ACCIDENTAL_WORDS[text];
  if (!accidental) {
    return null;
  }

  return {
    word,
    musicXml: accidental.musicXml,
    fallback: accidental.fallback,
    y: getWordY(word),
    placement: getWordPlacement(word),
  };
}

function directionWordElements(direction: Element): Element[] {
  return directChildren(direction, "direction-type").flatMap((directionType) => directChildren(directionType, "words"));
}

function getOrnaments(note: Element): Element | null {
  const notations = directChild(note, "notations");
  return notations ? directChild(notations, "ornaments") : null;
}

function removeWordDirection(word: Element): void {
  const directionType = word.parentElement;
  const direction = directionType?.parentElement;
  word.remove();
  if (directionType && directionType.localName === "direction-type" && directionType.children.length === 0) {
    directionType.remove();
  }
  if (direction && direction.localName === "direction" && directChildren(direction, "direction-type").length === 0) {
    direction.remove();
  }
}

function addOrnamentAccidental(ornaments: Element, accidental: PendingOrnamentAccidental, placement: "above" | "below"): void {
  const exists = directChildren(ornaments, "accidental-mark").some(
    (mark) => mark.getAttribute("placement") === placement && mark.textContent?.trim() === accidental.musicXml,
  );
  if (exists) {
    removeWordDirection(accidental.word);
    return;
  }

  const mark = ornaments.ownerDocument.createElement("accidental-mark");
  mark.setAttribute("placement", placement);
  mark.textContent = accidental.musicXml;
  ornaments.append(mark);
  removeWordDirection(accidental.word);
}

function addPendingAccidentalsToOrnament(ornaments: Element, pending: PendingOrnamentAccidental[]): void {
  if (pending.length === 1) {
    addOrnamentAccidental(ornaments, pending[0], pending[0].placement);
    return;
  }

  const sorted = [...pending].sort((a, b) => a.y - b.y);
  sorted.forEach((accidental, index) => {
    const placement = index === 0 ? "below" : index === sorted.length - 1 ? "above" : accidental.placement;
    addOrnamentAccidental(ornaments, accidental, placement);
  });
}

function preserveWordsWithFallback(pending: PendingOrnamentAccidental[]): void {
  for (const accidental of pending) {
    accidental.word.textContent = accidental.fallback;
    accidental.word.removeAttribute("font-family");
  }
}

function normalizeSmuflOrnamentAccidentals(doc: Document): void {
  for (const measure of elementsByLocalName(doc, "measure")) {
    const pending: PendingOrnamentAccidental[] = [];

    for (const child of Array.from(measure.children)) {
      if (child.localName === "direction") {
        for (const word of directionWordElements(child)) {
          const accidental = getSmuflAccidentalWord(word);
          if (accidental) {
            pending.push(accidental);
          }
        }
        continue;
      }

      if (child.localName !== "note" || pending.length === 0) {
        continue;
      }

      const ornaments = getOrnaments(child);
      if (ornaments) {
        addPendingAccidentalsToOrnament(ornaments, pending);
      } else {
        preserveWordsWithFallback(pending);
      }
      pending.length = 0;
    }

    preserveWordsWithFallback(pending);
  }
}

function removeUnsupportedPrivateUseWords(doc: Document): void {
  for (const word of elementsByLocalName(doc, "words")) {
    const text = word.textContent?.trim() ?? "";
    if (!PRIVATE_USE_RE.test(text)) {
      continue;
    }

    if (!canLikelyRenderDeclaredFont(word.getAttribute("font-family"), text)) {
      removeWordDirection(word);
    }
  }
}

function serializeXmlDocument(doc: Document): string {
  const serialized = new XMLSerializer().serializeToString(doc).trimStart();
  return serialized.startsWith("<?xml")
    ? serialized
    : `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
}

function prepareMusicXmlForDisplay(xml: string, removeFingerings: boolean): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (elementsByLocalName(doc, "parsererror").length > 0) {
    return xml;
  }

  if (removeFingerings) {
    for (const fingering of elementsByLocalName(doc, "fingering")) {
      fingering.remove();
    }
  }

  normalizePitchAlters(doc);
  normalizeGrandStaffPedals(doc);
  normalizeSmuflOrnamentAccidentals(doc);
  removeUnsupportedPrivateUseWords(doc);

  removeEmptyElements(doc, "technical");
  removeEmptyElements(doc, "notations");
  removeEmptyElements(doc, "direction-type");
  removeDirectionsWithoutTypes(doc);

  return serializeXmlDocument(doc);
}

export function prepareMusicXmlForPracticeDisplay(xml: string): string {
  return prepareMusicXmlForDisplay(xml, true);
}

export function prepareMusicXmlForAnalysisDisplay(xml: string): string {
  return prepareMusicXmlForDisplay(xml, false);
}
