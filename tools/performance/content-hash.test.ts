import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cacheDirectory } from "../project-paths";
import { canonicalTextSha256 } from "./content-hash";

describe("canonical text hashing", () => {
  it("treats LF and CRLF files as the same content", () => {
    const directory = path.join(cacheDirectory, "tests", "content-hash");
    const lfPath = path.join(directory, "lf.json");
    const crlfPath = path.join(directory, "crlf.json");
    mkdirSync(directory, { recursive: true });
    writeFileSync(lfPath, "{\n  \"value\": 1\n}\n", "utf8");
    writeFileSync(crlfPath, "{\r\n  \"value\": 1\r\n}\r\n", "utf8");

    expect(canonicalTextSha256(crlfPath)).toBe(canonicalTextSha256(lfPath));
  });

  it("detects material content changes", () => {
    const directory = path.join(cacheDirectory, "tests", "content-hash");
    const firstPath = path.join(directory, "first.json");
    const secondPath = path.join(directory, "second.json");
    mkdirSync(directory, { recursive: true });
    writeFileSync(firstPath, "{\n  \"value\": 1\n}\n", "utf8");
    writeFileSync(secondPath, "{\n  \"value\": 2\n}\n", "utf8");

    expect(canonicalTextSha256(secondPath)).not.toBe(canonicalTextSha256(firstPath));
  });
});
