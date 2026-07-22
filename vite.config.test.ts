import { describe, expect, it } from "vitest";
import { resolveReferenceAudioRequest } from "./vite.config";

const audio = {
  fileName: "reference.m4a",
  objectKey: "reference-audio/hash.m4a",
  sourcePath: "project/assets/reference-audio/reference.m4a",
};

describe("reference audio development source", () => {
  it("prefers the local recording when it exists", () => {
    expect(resolveReferenceAudioRequest(audio, "https://assets.example.com/", true)).toEqual({
      kind: "local",
      sourcePath: audio.sourcePath,
    });
  });

  it("falls back to the content-addressed remote object when local audio is missing", () => {
    expect(resolveReferenceAudioRequest(audio, "https://assets.example.com/root/", false)).toEqual({
      kind: "remote",
      url: "https://assets.example.com/root/reference-audio/hash.m4a",
    });
  });

  it("leaves a missing recording unresolved without a remote base URL", () => {
    expect(resolveReferenceAudioRequest(audio, "", false)).toBeNull();
  });
});
