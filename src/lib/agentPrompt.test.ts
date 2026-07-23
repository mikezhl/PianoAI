import { describe, expect, it } from "vitest";
import {
  AGENT_GUIDE_PATH,
  buildAgentPrompt,
  resolveAgentGuideUrl,
} from "./agentPrompt";

describe("AI agent prompt", () => {
  it("resolves the guide against the current application base", () => {
    expect(resolveAgentGuideUrl("https://example.com/piano-ai/app", "/piano-ai/")).toBe(
      "https://example.com/piano-ai/data/agent-guide.txt",
    );
    expect(AGENT_GUIDE_PATH).toBe("/data/agent-guide.txt");
  });

  it("keeps the prompt concise without restricting other sources", () => {
    const guideUrl = "https://example.com/data/agent-guide.txt";
    const prompt = buildAgentPrompt(guideUrl);

    expect(prompt).toContain(guideUrl);
    expect(prompt).toContain("其他来源");
    expect(prompt).toContain("PianoAI 证据不足");
    expect(prompt).toContain("默认用中文");
    expect(prompt).toContain("每个 URL 只读取一次");
    expect(prompt).toContain("先给出清晰结论");
    expect(prompt).toContain("不要复述数据结构、检索过程");
    expect(prompt).not.toContain("不使用外部资料");
    expect(prompt).not.toContain("不获取或分析录音");
    expect(prompt.length).toBeLessThan(420);
  });
});
