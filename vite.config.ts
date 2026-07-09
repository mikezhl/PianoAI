import react from "@vitejs/plugin-react";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { defineConfig } from "vite";

const MUSICXML_LIBRARY_MODULE_ID = "virtual:musicxml-library";
const RESOLVED_MUSICXML_LIBRARY_MODULE_ID = `\0${MUSICXML_LIBRARY_MODULE_ID}`;
const MUSICXML_ASSET_DIR = "__musicxml";
const SCORE_FILE_EXTENSION_RE = /\.(?:musicxml|mxl|xml)$/i;

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

  return readdirSync(libraryDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && SCORE_FILE_EXTENSION_RE.test(entry.name))
    .map((entry) => ({
      id: `musicxml:${entry.name}`,
      name: scoreDisplayName(entry.name),
      fileName: entry.name,
      url: scoreUrl(entry.name, base),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

function musicXmlLibraryPlugin(): Plugin {
  let base = "/";
  let publicDir = "";
  let libraryDir = "";

  function loadModuleCode(): string {
    return `export const MUSICXML_LIBRARY = ${JSON.stringify(readMusicXmlLibrary(publicDir, base), null, 2)};\n`;
  }

  function reloadLibraryModule(server: ViteDevServer, filePath: string): void {
    if (!SCORE_FILE_EXTENSION_RE.test(filePath) || !path.normalize(filePath).startsWith(`${libraryDir}${path.sep}`)) {
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
      publicDir = config.publicDir === false ? path.resolve(config.root, "public") : path.resolve(config.publicDir);
      libraryDir = path.join(publicDir, "musicxml");
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
      server.watcher.on("add", (filePath) => reloadLibraryModule(server, filePath));
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
  plugins: [musicXmlLibraryPlugin(), react()],
});
