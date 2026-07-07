const MAX_TEXT_SCORE_BYTES = 12 * 1024 * 1024;
const MAX_MXL_BYTES = 20 * 1024 * 1024;
const MAX_MXL_ENTRY_COUNT = 256;
const MAX_CONTAINER_BYTES = 128 * 1024;

interface ZipTextEntry {
  async: (type: "text") => Promise<string>;
  _data?: {
    uncompressedSize?: number;
  };
}

interface ScoreFileSource {
  name: string;
  size: number;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

function isMxlFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".mxl");
}

function assertWithinBytes(size: number, maxBytes: number, message: string): void {
  if (size > maxBytes) {
    throw new Error(message);
  }
}

function textByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

async function readZipText(entry: ZipTextEntry, maxBytes: number, message: string): Promise<string> {
  const uncompressedSize = entry._data?.uncompressedSize;
  if (typeof uncompressedSize === "number" && Number.isFinite(uncompressedSize)) {
    assertWithinBytes(uncompressedSize, maxBytes, message);
  }

  const text = await entry.async("text");
  assertWithinBytes(textByteLength(text), maxBytes, message);
  return text;
}

function findRootFilePath(containerXml: string): string | null {
  const doc = new DOMParser().parseFromString(containerXml, "application/xml");
  const rootfile = Array.from(doc.getElementsByTagNameNS("*", "rootfile")).find((element) =>
    element.hasAttribute("full-path"),
  );
  return rootfile?.getAttribute("full-path") ?? null;
}

async function readScoreXmlFromSource(source: ScoreFileSource): Promise<string> {
  if (!isMxlFileName(source.name)) {
    assertWithinBytes(source.size, MAX_TEXT_SCORE_BYTES, "谱面文件超过 12MB");
    return source.text();
  }

  assertWithinBytes(source.size, MAX_MXL_BYTES, "MXL 文件超过 20MB");

  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await source.arrayBuffer());
  const paths = Object.keys(zip.files);
  if (paths.length > MAX_MXL_ENTRY_COUNT) {
    throw new Error("MXL 文件内容过多");
  }

  const container = zip.file("META-INF/container.xml");
  let scorePath: string | null = null;

  if (container) {
    scorePath = findRootFilePath(await readZipText(container, MAX_CONTAINER_BYTES, "MXL 容器描述过大"));
  }

  if (!scorePath) {
    scorePath =
      paths.find((path) => {
        const lower = path.toLowerCase();
        return !zip.files[path].dir && lower.endsWith(".xml") && lower !== "meta-inf/container.xml";
      }) ?? null;
  }

  if (!scorePath) {
    throw new Error("MXL 文件中没有找到 MusicXML 谱面");
  }

  const scoreFile = zip.file(scorePath);
  if (!scoreFile) {
    throw new Error("MXL 文件中的谱面路径无效");
  }

  return readZipText(scoreFile, MAX_TEXT_SCORE_BYTES, "MXL 解压后的谱面超过 12MB");
}

export function readScoreXmlFromFile(file: File): Promise<string> {
  return readScoreXmlFromSource(file);
}

export async function readScoreXmlFromUrl(url: string, fileName: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("预设谱加载失败");
  }

  const bytes = await response.arrayBuffer();
  return readScoreXmlFromSource({
    name: fileName,
    size: bytes.byteLength,
    text: () => Promise.resolve(new TextDecoder().decode(bytes)),
    arrayBuffer: () => Promise.resolve(bytes.slice(0)),
  });
}
