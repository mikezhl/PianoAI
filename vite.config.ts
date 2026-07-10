import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { defineConfig } from "vite";

const MUSICXML_LIBRARY_MODULE_ID = "virtual:musicxml-library";
const RESOLVED_MUSICXML_LIBRARY_MODULE_ID = `\0${MUSICXML_LIBRARY_MODULE_ID}`;
const MUSICXML_ASSET_DIR = "__musicxml";
const SCORE_FILE_EXTENSION_RE = /\.(?:musicxml|mxl|xml)$/i;

interface AnalysisManifestItem {
  scoreId: string;
  fileName: string;
  analysisFile: string;
  sourceHash: string;
}

interface AnalysisManifest {
  schemaVersion: string;
  items: AnalysisManifestItem[];
}

function scoreDisplayName(fileName: string): string {
  return fileName.replace(SCORE_FILE_EXTENSION_RE, "");
}

function encodeScoreFileName(fileName: string): string {
  return Buffer.from(fileName, "utf8").toString("base64url");
}

function decodeScoreFileName(encodedFileName: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(encodedFileName)) {
    return null;
  }

  try {
    const fileName = Buffer.from(encodedFileName, "base64url").toString("utf8");
    return encodeScoreFileName(fileName) === encodedFileName ? fileName : null;
  } catch {
    return null;
  }
}

function scoreAssetName(fileName: string): string {
  return `${encodeScoreFileName(fileName)}${path.extname(fileName).toLowerCase()}`;
}

function normalizeBase(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}

function scoreUrl(fileName: string, base: string): string {
  return `${normalizeBase(base)}${MUSICXML_ASSET_DIR}/${scoreAssetName(fileName)}`;
}

function contentType(fileName: string): string {
  return fileName.toLowerCase().endsWith(".mxl")
    ? "application/vnd.recordare.musicxml"
    : "application/vnd.recordare.musicxml+xml";
}

function analysisUrl(fileName: string, base: string): string {
  return `${normalizeBase(base)}analysis/${encodeURIComponent(fileName)}`;
}

function sha256(filePath: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(filePath)).digest("hex").toUpperCase()}`;
}

function readAnalysisManifest(publicDir: string): AnalysisManifestItem[] {
  const manifestPath = path.join(publicDir, "analysis", "manifest.json");
  if (!existsSync(manifestPath)) {
    return [];
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as AnalysisManifest;
  if (manifest.schemaVersion !== "2.1.0" || !Array.isArray(manifest.items)) {
    throw new Error("public/analysis/manifest.json 格式不受支持");
  }

  const seenScoreIds = new Set<string>();
  const seenFileNames = new Set<string>();
  const seenAnalysisFiles = new Set<string>();
  for (const item of manifest.items) {
    if (
      !item.scoreId
      || path.basename(item.fileName) !== item.fileName
      || path.basename(item.analysisFile) !== item.analysisFile
      || !/^sha256:[0-9A-F]{64}$/.test(item.sourceHash)
    ) {
      throw new Error(`分析 manifest 条目无效：${JSON.stringify(item)}`);
    }
    if (
      seenScoreIds.has(item.scoreId)
      || seenFileNames.has(item.fileName)
      || seenAnalysisFiles.has(item.analysisFile)
    ) {
      throw new Error(`分析 manifest 存在重复条目：${item.scoreId}`);
    }
    seenScoreIds.add(item.scoreId);
    seenFileNames.add(item.fileName);
    seenAnalysisFiles.add(item.analysisFile);
  }

  return manifest.items;
}

function validateAnalysisItem(publicDir: string, item: AnalysisManifestItem): void {
  const scorePath = path.join(publicDir, "musicxml", item.fileName);
  const analysisPath = path.join(publicDir, "analysis", item.analysisFile);
  if (!existsSync(scorePath)) {
    throw new Error(`分析关联的谱面不存在：${item.fileName}`);
  }
  if (!existsSync(analysisPath)) {
    throw new Error(`分析文件不存在：${item.analysisFile}`);
  }

  if (sha256(scorePath) !== item.sourceHash) {
    throw new Error(`谱面哈希与分析 manifest 不一致：${item.fileName}`);
  }

  const analysis = JSON.parse(readFileSync(analysisPath, "utf8")) as {
    schemaVersion?: string;
    score?: { id?: string; sourceFile?: string; sourceHash?: string };
  };
  if (
    analysis.schemaVersion !== "2.1.0"
    || analysis.score?.id !== item.scoreId
    || analysis.score.sourceFile !== item.fileName
    || analysis.score.sourceHash !== item.sourceHash
  ) {
    throw new Error(`分析文件身份与 manifest 不一致：${item.analysisFile}`);
  }
}

function parseMusicXmlAssetRequest(url: string | undefined, base: string): string | null {
  if (!url) {
    return null;
  }

  let pathname = "";
  try {
    pathname = new URL(url, "http://localhost").pathname;
  } catch {
    return null;
  }

  const prefix = `${normalizeBase(base)}${MUSICXML_ASSET_DIR}/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const assetName = pathname.slice(prefix.length);
  if (assetName.includes("/") || assetName.includes("\\")) {
    return null;
  }

  const extension = path.posix.extname(assetName).toLowerCase();
  const encodedFileName = assetName.slice(0, assetName.length - extension.length);
  const fileName = decodeScoreFileName(encodedFileName);
  if (!fileName || path.extname(fileName).toLowerCase() !== extension || !SCORE_FILE_EXTENSION_RE.test(fileName)) {
    return null;
  }

  return fileName;
}

function resolveLibraryFile(libraryDir: string, fileName: string): string | null {
  if (path.basename(fileName) !== fileName || !SCORE_FILE_EXTENSION_RE.test(fileName)) {
    return null;
  }

  const resolvedLibraryDir = path.resolve(libraryDir);
  const resolvedFilePath = path.resolve(resolvedLibraryDir, fileName);
  if (!resolvedFilePath.startsWith(`${resolvedLibraryDir}${path.sep}`)) {
    return null;
  }

  try {
    return statSync(resolvedFilePath).isFile() ? resolvedFilePath : null;
  } catch {
    return null;
  }
}

function readMusicXmlLibrary(publicDir: string, base: string) {
  const libraryDir = path.join(publicDir, "musicxml");
  if (!existsSync(libraryDir)) {
    return [];
  }

  const analysisItems = readAnalysisManifest(publicDir);
  analysisItems.forEach((item) => validateAnalysisItem(publicDir, item));
  const analysisByFileName = new Map(analysisItems.map((item) => [item.fileName, item]));

  return readdirSync(libraryDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && SCORE_FILE_EXTENSION_RE.test(entry.name))
    .map((entry) => {
      const analysis = analysisByFileName.get(entry.name);
      return {
        id: `musicxml:${entry.name}`,
        name: scoreDisplayName(entry.name),
        fileName: entry.name,
        url: scoreUrl(entry.name, base),
        scoreId: analysis?.scoreId,
        analysisUrl: analysis ? analysisUrl(analysis.analysisFile, base) : undefined,
        sourceHash: analysis?.sourceHash,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

function musicXmlLibraryPlugin(): Plugin {
  let base = "/";
  let publicDir = "";
  let libraryDir = "";
  let analysisDir = "";

  function loadModuleCode(): string {
    return `export const MUSICXML_LIBRARY = ${JSON.stringify(readMusicXmlLibrary(publicDir, base), null, 2)};\n`;
  }

  function reloadLibraryModule(server: ViteDevServer, filePath: string): void {
    const normalizedPath = path.normalize(filePath);
    const isScoreFile = SCORE_FILE_EXTENSION_RE.test(filePath) && normalizedPath.startsWith(`${libraryDir}${path.sep}`);
    const isAnalysisFile = normalizedPath.startsWith(`${analysisDir}${path.sep}`);
    if (!isScoreFile && !isAnalysisFile) {
      return;
    }

    const module = server.moduleGraph.getModuleById(RESOLVED_MUSICXML_LIBRARY_MODULE_ID);
    if (module) {
      server.moduleGraph.invalidateModule(module);
    }
    server.ws.send({ type: "full-reload" });
  }

  return {
    name: "musicxml-library",
    configResolved(config) {
      base = config.base;
      publicDir = path.resolve(config.publicDir);
      libraryDir = path.join(publicDir, "musicxml");
      analysisDir = path.join(publicDir, "analysis");
    },
    resolveId(id) {
      return id === MUSICXML_LIBRARY_MODULE_ID ? RESOLVED_MUSICXML_LIBRARY_MODULE_ID : null;
    },
    load(id) {
      return id === RESOLVED_MUSICXML_LIBRARY_MODULE_ID ? loadModuleCode() : null;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const fileName = parseMusicXmlAssetRequest(req.url, base);
        if (!fileName) {
          next();
          return;
        }

        const filePath = resolveLibraryFile(libraryDir, fileName);
        if (!filePath) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        res.setHeader("Content-Type", contentType(fileName));
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(filePath).on("error", next).pipe(res);
      });

      server.watcher.add(libraryDir);
      server.watcher.add(analysisDir);
      server.watcher.on("add", (filePath) => reloadLibraryModule(server, filePath));
      server.watcher.on("change", (filePath) => reloadLibraryModule(server, filePath));
      server.watcher.on("unlink", (filePath) => reloadLibraryModule(server, filePath));
    },
    generateBundle() {
      if (!existsSync(libraryDir)) {
        return;
      }

      for (const entry of readdirSync(libraryDir, { withFileTypes: true })) {
        if (!entry.isFile() || !SCORE_FILE_EXTENSION_RE.test(entry.name)) {
          continue;
        }

        const filePath = path.join(libraryDir, entry.name);
        this.emitFile({
          type: "asset",
          fileName: `${MUSICXML_ASSET_DIR}/${scoreAssetName(entry.name)}`,
          source: readFileSync(filePath),
        });
      }
    },
  };
}

export default defineConfig({
  cacheDir: ".cache/vite",
  plugins: [musicXmlLibraryPlugin(), react()],
});
