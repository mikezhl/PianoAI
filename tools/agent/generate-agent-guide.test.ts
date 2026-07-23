import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAgentGuide } from "./generate-agent-guide";

const projectRoot = process.cwd();

interface ScoreCatalog {
  items: Array<{ scoreId: string }>;
}

interface ReferenceCatalog {
  references: Array<{ interpretationId: string }>;
}

describe("agent data guide", () => {
  it("matches the generated catalog and lists every public data file", () => {
    const rendered = buildAgentGuide(projectRoot);
    const stored = readFileSync(path.join(projectRoot, "data", "agent-guide.txt"), "utf8");
    const scores = JSON.parse(
      readFileSync(path.join(projectRoot, "data", "catalog.json"), "utf8"),
    ) as ScoreCatalog;
    const references = JSON.parse(
      readFileSync(path.join(projectRoot, "data", "performances", "catalog.json"), "utf8"),
    ) as ReferenceCatalog;

    expect(stored).toBe(rendered);
    expect(rendered).toContain("常规检索无需再次读取");
    expect(rendered).toContain("每个 URL 只请求一次");
    expect(rendered).toContain("先直接回答用户问题");
    expect(rendered).toContain("不要用覆盖率、百分位和置信度堆满正文");
    for (const score of scores.items) {
      expect(rendered).toContain(`data/scores/${score.scoreId}.mxl`);
      expect(rendered).toContain(`data/analyses/${score.scoreId}.json`);
    }
    for (const reference of references.references) {
      expect(rendered).toContain(
        `data/performances/interpretations/${reference.interpretationId}.json`,
      );
    }
  });
});
