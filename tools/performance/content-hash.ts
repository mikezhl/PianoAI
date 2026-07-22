import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function canonicalTextSha256(filePath: string): string {
  const content = readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex").toUpperCase()}`;
}
