import react from "@vitejs/plugin-react";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { defineConfig } from "vite";

const MUSICXML_LIBRARY_MODULE_ID = "virtual:musicxml-library";
const RESOLVED_MUSICXML_LIBRARY_MODULE_ID = `\0${MUSICXML_LIBRARY_MODULE_ID}`;
const SCORE_FILE_EXTENSION_RE = /\.(?:musicxml|mxl|xml)$/i;

function scoreDisplayName(fileName: string): string {
  return fileName.replace(SCORE_FILE_EXTENSION_RE, "");
}

function scoreUrl(fileName: string): string {
  return `/musicxml/${encodeURIComponent(fileName)}`;
}

function readMusicXmlLibrary(publicDir: string) {
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
      url: scoreUrl(entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

function musicXmlLibraryPlugin(): Plugin {
  let publicDir = "";
  let libraryDir = "";

  function loadModuleCode(): string {
    return `export const MUSICXML_LIBRARY = ${JSON.stringify(readMusicXmlLibrary(publicDir), null, 2)};\n`;
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
      server.watcher.add(libraryDir);
      server.watcher.on("add", (filePath) => reloadLibraryModule(server, filePath));
      server.watcher.on("unlink", (filePath) => reloadLibraryModule(server, filePath));
    },
  };
}

export default defineConfig({
  plugins: [musicXmlLibraryPlugin(), react()],
});
