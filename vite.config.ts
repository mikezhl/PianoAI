import react from "@vitejs/plugin-react";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { defineConfig, loadEnv } from "vite";

const MUSICXML_LIBRARY_MODULE_ID = "virtual:musicxml-library";
const RESOLVED_MUSICXML_LIBRARY_MODULE_ID = `\0${MUSICXML_LIBRARY_MODULE_ID}`;
const LOCAL_REFERENCE_AUDIO_PREFIX = "__reference_audio__";
const DEFAULT_DEVELOPMENT_REFERENCE_AUDIO_BASE_URL = "https://assets.piano.2226.love/";
const SCORE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const REFERENCE_AUDIO_EXTENSION_RE = /\.(?:m4a|mp3|wav|flac|ogg)$/i;

interface ScoreCatalogItem {
  scoreId: string;
  title: string;
  sourceHash: string;
}

interface ScoreCatalog {
  schemaVersion: string;
  items: ScoreCatalogItem[];
}

interface ReferenceAudioCatalog {
  schemaVersion: string;
  references: Array<{
    interpretationId: string;
    audio: {
      fileName: string;
      objectKey: string;
      sha256: string;
      format: string;
    };
  }>;
}

interface RuntimeAsset {
  fileName: string;
  sourcePath: string;
}

export interface ReferencedAudioFile {
  fileName: string;
  objectKey: string;
  sourcePath: string;
}

export type ReferenceAudioRequestSource =
  | { kind: "local"; sourcePath: string }
  | { kind: "remote"; url: string }
  | null;

function normalizeBase(base: string): string {
  const withLeadingSlash = base.startsWith("/") ? base : `/${base}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function appAssetUrl(fileName: string, base: string): string {
  return `${normalizeBase(base)}${fileName.replace(/^\/+/, "")}`;
}

function prefixedSha256(filePath: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(filePath)).digest("hex").toUpperCase()}`;
}

function plainSha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex").toUpperCase();
}

function contentType(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".mxl") return "application/vnd.recordare.musicxml";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".m4a") return "audio/mp4";
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".flac") return "audio/flac";
  if (extension === ".ogg") return "audio/ogg";
  if (extension === ".md" || extension === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function projectPaths(root: string) {
  const dataDirectory = path.join(root, "data");
  return {
    dataDirectory,
    scoreCatalogPath: path.join(dataDirectory, "catalog.json"),
    scoreDirectory: path.join(dataDirectory, "scores"),
    analysisDirectory: path.join(dataDirectory, "analyses"),
    performanceDirectory: path.join(dataDirectory, "performances"),
    performanceCatalogPath: path.join(dataDirectory, "performances", "catalog.json"),
    interpretationDirectory: path.join(dataDirectory, "performances", "interpretations"),
    pianoDirectory: path.join(root, "src", "assets", "piano", "salamander-v8"),
    referenceAudioDirectory: path.join(root, "assets", "reference-audio"),
  };
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readScoreCatalog(root: string, validateFiles: boolean): ScoreCatalogItem[] {
  const directories = projectPaths(root);
  const catalog = readJson<ScoreCatalog>(directories.scoreCatalogPath);
  if (catalog.schemaVersion !== "2.1.0" || !Array.isArray(catalog.items)) {
    throw new Error("data/catalog.json 格式不受支持");
  }

  const scoreIds = new Set<string>();
  for (const item of catalog.items) {
    if (
      !SCORE_ID_RE.test(item.scoreId)
      || !item.title
      || !/^sha256:[0-9A-F]{64}$/.test(item.sourceHash)
      || scoreIds.has(item.scoreId)
    ) {
      throw new Error(`曲库 catalog 条目无效：${JSON.stringify(item)}`);
    }
    scoreIds.add(item.scoreId);

    if (!validateFiles) continue;
    const scorePath = path.join(directories.scoreDirectory, `${item.scoreId}.mxl`);
    const analysisPath = path.join(directories.analysisDirectory, `${item.scoreId}.json`);
    if (!existsSync(scorePath) || !existsSync(analysisPath)) {
      throw new Error(`曲库文件不完整：${item.scoreId}`);
    }
    if (prefixedSha256(scorePath) !== item.sourceHash) {
      throw new Error(`谱面哈希与 catalog 不一致：${item.scoreId}`);
    }
    const analysis = readJson<{
      schemaVersion?: string;
      score?: { id?: string; sourceFile?: string; sourceHash?: string; title?: string };
    }>(analysisPath);
    if (
      analysis.schemaVersion !== "2.1.0"
      || analysis.score?.id !== item.scoreId
      || analysis.score.sourceFile !== `${item.scoreId}.mxl`
      || analysis.score.sourceHash !== item.sourceHash
      || analysis.score.title !== item.title
    ) {
      throw new Error(`分析文件身份与 catalog 不一致：${item.scoreId}`);
    }
  }
  return catalog.items;
}

function readReferenceCatalog(root: string): ReferenceAudioCatalog {
  const catalog = readJson<ReferenceAudioCatalog>(projectPaths(root).performanceCatalogPath);
  if (catalog.schemaVersion !== "2.1.0" || !Array.isArray(catalog.references)) {
    throw new Error("data/performances/catalog.json 格式不受支持");
  }
  return catalog;
}

async function canonicalScoreXmlHash(filePath: string): Promise<string> {
  const zip = await JSZip.loadAsync(readFileSync(filePath));
  const container = zip.file("META-INF/container.xml");
  const containerXml = container ? await container.async("text") : "";
  const rootPath = /<rootfile\b[^>]*\bfull-path=["']([^"']+)["']/i.exec(containerXml)?.[1]
    ?? Object.keys(zip.files).find((entryPath) => {
      const lower = entryPath.toLowerCase();
      return !zip.files[entryPath].dir && lower.endsWith(".xml") && lower !== "meta-inf/container.xml";
    });
  const scoreEntry = rootPath ? zip.file(rootPath) : null;
  if (!scoreEntry) throw new Error(`MXL 文件中没有找到 MusicXML 谱面：${filePath}`);
  return `sha256:${createHash("sha256")
    .update(await scoreEntry.async("text"), "utf8")
    .digest("hex")
    .toUpperCase()}`;
}

async function readMusicXmlLibrary(root: string, base: string) {
  const directories = projectPaths(root);
  const items = readScoreCatalog(root, true);
  return Promise.all(items.map(async (item) => {
    const fileName = `${item.scoreId}.mxl`;
    return {
      id: `musicxml:${item.scoreId}`,
      name: item.title,
      fileName,
      url: appAssetUrl(`data/scores/${fileName}`, base),
      scoreId: item.scoreId,
      analysisUrl: appAssetUrl(`data/analyses/${item.scoreId}.json`, base),
      sourceHash: item.sourceHash,
      canonicalHash: await canonicalScoreXmlHash(path.join(directories.scoreDirectory, fileName)),
    };
  }));
}

function runtimeAssets(root: string): RuntimeAsset[] {
  const directories = projectPaths(root);
  const scores = readScoreCatalog(root, false);
  const references = readReferenceCatalog(root).references;
  const assets: RuntimeAsset[] = [
    { fileName: "data/catalog.json", sourcePath: directories.scoreCatalogPath },
    { fileName: "data/performances/catalog.json", sourcePath: directories.performanceCatalogPath },
    ...scores.flatMap((item) => [
      {
        fileName: `data/scores/${item.scoreId}.mxl`,
        sourcePath: path.join(directories.scoreDirectory, `${item.scoreId}.mxl`),
      },
      {
        fileName: `data/analyses/${item.scoreId}.json`,
        sourcePath: path.join(directories.analysisDirectory, `${item.scoreId}.json`),
      },
    ]),
    ...references.map((reference) => ({
      fileName: `data/performances/interpretations/${reference.interpretationId}.json`,
      sourcePath: path.join(directories.interpretationDirectory, `${reference.interpretationId}.json`),
    })),
    ...readdirSync(directories.pianoDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => ({
        fileName: `audio/piano/salamander-v8/${entry.name}`,
        sourcePath: path.join(directories.pianoDirectory, entry.name),
      })),
  ];
  const missing = assets.find((asset) => !existsSync(asset.sourcePath));
  if (missing) throw new Error(`运行时资产不存在：${missing.sourcePath}`);
  return assets;
}

function requestAssetPath(url: string | undefined, base: string): string | null {
  if (!url) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    return null;
  }
  const prefix = normalizeBase(base);
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : null;
}

function serveFile(
  req: IncomingMessage,
  res: ServerResponse,
  sourcePath: string,
  next: (error?: unknown) => void,
): void {
  const size = statSync(sourcePath).size;
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Content-Type", contentType(sourcePath));
  res.setHeader("Content-Length", size);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(sourcePath).on("error", next).pipe(res);
}

function runtimeDataPlugin(): Plugin {
  let root = "";
  let base = "/";
  let assetByRequestPath = new Map<string, RuntimeAsset>();

  function refreshAssets(): void {
    assetByRequestPath = new Map(runtimeAssets(root).map((asset) => [asset.fileName, asset]));
  }

  function reloadLibraryModule(server: ViteDevServer): void {
    refreshAssets();
    const module = server.moduleGraph.getModuleById(RESOLVED_MUSICXML_LIBRARY_MODULE_ID);
    if (module) server.moduleGraph.invalidateModule(module);
    server.ws.send({ type: "full-reload" });
  }

  return {
    name: "pianoai-runtime-data",
    configResolved(config) {
      root = config.root;
      base = config.base;
      refreshAssets();
    },
    resolveId(id) {
      return id === MUSICXML_LIBRARY_MODULE_ID ? RESOLVED_MUSICXML_LIBRARY_MODULE_ID : null;
    },
    load(id) {
      return id === RESOLVED_MUSICXML_LIBRARY_MODULE_ID
        ? readMusicXmlLibrary(root, base).then((library) => (
          `export const MUSICXML_LIBRARY = ${JSON.stringify(library, null, 2)};\n`
        ))
        : null;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const requestedPath = requestAssetPath(req.url, base);
        const asset = requestedPath ? assetByRequestPath.get(requestedPath) : undefined;
        if (!asset) return next();
        serveFile(req, res, asset.sourcePath, next);
      });

      const directories = projectPaths(root);
      server.watcher.add(directories.dataDirectory);
      server.watcher.on("add", (filePath) => {
        if (filePath.startsWith(directories.dataDirectory)) reloadLibraryModule(server);
      });
      server.watcher.on("unlink", (filePath) => {
        if (filePath.startsWith(directories.dataDirectory)) reloadLibraryModule(server);
      });
      server.watcher.on("change", (filePath) => {
        if (filePath.startsWith(directories.dataDirectory)) reloadLibraryModule(server);
      });
    },
    generateBundle() {
      for (const asset of runtimeAssets(root)) {
        this.emitFile({ type: "asset", fileName: asset.fileName, source: readFileSync(asset.sourcePath) });
      }
    },
  };
}

function parseByteRange(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match || fileSize <= 0) return null;
  const [, startText, endText] = match;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!endText || !Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, fileSize - suffixLength), end: fileSize - 1 };
  }
  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : fileSize - 1;
  const end = Math.min(fileSize - 1, requestedEnd);
  return Number.isSafeInteger(start)
    && Number.isSafeInteger(requestedEnd)
    && start >= 0
    && start < fileSize
    && start <= end
    ? { start, end }
    : null;
}

function readReferencedAudioFiles(root: string, validateHash: boolean): ReferencedAudioFile[] {
  const directories = projectPaths(root);
  const files = new Map<string, ReferencedAudioFile>();
  for (const reference of readReferenceCatalog(root).references) {
    const { fileName, objectKey, sha256 } = reference.audio;
    if (
      path.basename(fileName) !== fileName
      || !REFERENCE_AUDIO_EXTENSION_RE.test(fileName)
      || objectKey !== `reference-audio/${sha256.toLowerCase()}${path.extname(fileName).toLowerCase()}`
    ) {
      throw new Error(`参考录音身份无效：${reference.interpretationId}`);
    }
    const sourcePath = path.join(directories.referenceAudioDirectory, fileName);
    if (!existsSync(sourcePath)) {
      if (validateHash) throw new Error(`参考录音文件不存在：${fileName}`);
    } else if (validateHash && plainSha256(sourcePath) !== sha256) {
      throw new Error(`参考录音校验失败：${fileName}`);
    }
    files.set(fileName, { fileName, objectKey, sourcePath });
  }
  return [...files.values()].sort((left, right) => left.fileName.localeCompare(right.fileName));
}

export function resolveReferenceAudioRequest(
  audio: ReferencedAudioFile,
  remoteBaseUrl: string,
  localFileExists: boolean,
): ReferenceAudioRequestSource {
  if (localFileExists) {
    return { kind: "local", sourcePath: audio.sourcePath };
  }
  if (!remoteBaseUrl) {
    return null;
  }
  const encodedObjectKey = audio.objectKey.split("/").map(encodeURIComponent).join("/");
  return {
    kind: "remote",
    url: `${remoteBaseUrl.replace(/\/+$/, "")}/${encodedObjectKey}`,
  };
}

function referenceAudioPlugin(localBuild: boolean, developmentRemoteBaseUrl: string): Plugin {
  let root = "";
  let base = "/";
  let outDirectory = "";
  let audioByFileName = new Map<string, ReferencedAudioFile>();

  return {
    name: "pianoai-reference-audio",
    configResolved(config) {
      root = config.root;
      base = config.base;
      outDirectory = path.resolve(root, config.build.outDir);
      if (config.command === "serve" || localBuild) {
        audioByFileName = new Map(readReferencedAudioFiles(root, localBuild)
          .map((file) => [file.fileName, file]));
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const requestedPath = requestAssetPath(req.url, base);
        const prefix = `${LOCAL_REFERENCE_AUDIO_PREFIX}/`;
        const fileName = requestedPath?.startsWith(prefix) ? requestedPath.slice(prefix.length) : "";
        const audio = audioByFileName.get(fileName);
        if (!audio) return next();

        const source = resolveReferenceAudioRequest(
          audio,
          developmentRemoteBaseUrl,
          existsSync(audio.sourcePath),
        );
        if (!source) return next();
        if (source.kind === "remote") {
          res.statusCode = 307;
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Location", source.url);
          res.end();
          return;
        }

        const fileSize = statSync(source.sourcePath).size;
        const rangeHeader = req.headers.range;
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Content-Type", contentType(audio.fileName));
        if (rangeHeader) {
          const range = parseByteRange(rangeHeader, fileSize);
          if (!range) {
            res.statusCode = 416;
            res.setHeader("Content-Range", `bytes */${fileSize}`);
            res.end();
            return;
          }
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${fileSize}`);
          res.setHeader("Content-Length", range.end - range.start + 1);
          if (req.method === "HEAD") return void res.end();
          createReadStream(source.sourcePath, range).on("error", next).pipe(res);
          return;
        }
        res.setHeader("Content-Length", fileSize);
        if (req.method === "HEAD") return void res.end();
        createReadStream(source.sourcePath).on("error", next).pipe(res);
      });
    },
    writeBundle() {
      if (!localBuild) return;
      const targetDirectory = path.join(outDirectory, LOCAL_REFERENCE_AUDIO_PREFIX);
      mkdirSync(targetDirectory, { recursive: true });
      for (const audio of audioByFileName.values()) {
        copyFileSync(audio.sourcePath, path.join(targetDirectory, audio.fileName));
      }
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const localBuild = command === "build" && mode === "offline";
  const onlineBuild = command === "build" && !localBuild;
  const environment = loadEnv(mode, process.cwd(), "VITE_");
  const configuredReferenceAudioBaseUrl = environment.VITE_REFERENCE_AUDIO_BASE_URL?.trim() ?? "";
  const referenceAudioBaseUrl = onlineBuild ? configuredReferenceAudioBaseUrl : "";
  const developmentReferenceAudioBaseUrl = command === "serve"
    ? configuredReferenceAudioBaseUrl || DEFAULT_DEVELOPMENT_REFERENCE_AUDIO_BASE_URL
    : "";
  if (onlineBuild && !/^https:\/\/[^/]+(?:\/.*)?$/.test(referenceAudioBaseUrl)) {
    throw new Error("在线构建必须配置 HTTPS 的 VITE_REFERENCE_AUDIO_BASE_URL（Cloudflare R2 公共域名）");
  }
  if (developmentReferenceAudioBaseUrl && !/^https:\/\/[^/]+(?:\/.*)?$/.test(developmentReferenceAudioBaseUrl)) {
    throw new Error("开发模式的 VITE_REFERENCE_AUDIO_BASE_URL 必须是 HTTPS URL");
  }

  return {
    publicDir: false,
    cacheDir: ".cache/vite",
    define: {
      __REFERENCE_AUDIO_BASE_URL__: JSON.stringify(referenceAudioBaseUrl),
    },
    server: {
      port: 5173,
      strictPort: true,
      watch: {
        ignored: ["**/.cache/**", "**/.local/**", "**/assets/**"],
      },
    },
    plugins: [runtimeDataPlugin(), referenceAudioPlugin(localBuild, developmentReferenceAudioBaseUrl), react()],
  };
});
