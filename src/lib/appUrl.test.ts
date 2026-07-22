import { describe, expect, it } from "vitest";
import { resolveAppAssetUrl } from "./appUrl";

describe("application asset URLs", () => {
  it("places root-style asset paths under the configured application base", () => {
    expect(resolveAppAssetUrl("/data/performances/catalog.json", "/piano-ai/")).toBe(
      "/piano-ai/data/performances/catalog.json",
    );
    expect(resolveAppAssetUrl("audio/piano.mp3", "/piano-ai")).toBe("/piano-ai/audio/piano.mp3");
  });

  it("leaves absolute and protocol-relative URLs unchanged", () => {
    expect(resolveAppAssetUrl("https://example.com/audio.mp3", "/piano-ai/")).toBe(
      "https://example.com/audio.mp3",
    );
    expect(resolveAppAssetUrl("//cdn.example.com/audio.mp3", "/piano-ai/")).toBe(
      "//cdn.example.com/audio.mp3",
    );
  });
});
