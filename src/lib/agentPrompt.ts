import { resolveAppAssetUrl } from "./appUrl";

export const AGENT_GUIDE_PATH = "/data/agent-guide.txt";

export function resolveAgentGuideUrl(
  currentLocation: string,
  base = import.meta.env.BASE_URL,
): string {
  return new URL(resolveAppAssetUrl(AGENT_GUIDE_PATH, base), currentLocation).href;
}

export function buildAgentPrompt(guideUrl: string): string {
  return [
    "回答我接下来的音乐问题时，请按需使用 PianoAI 的公开数据：",
    guideUrl,
    "",
    "请先阅读指南，从完整索引中定位文件；每个 URL 只读取一次，并在本轮对话中复用已获取的内容。",
    "",
    "请围绕问题先给出清晰结论，再用少量最相关的音乐证据解释。不要复述数据结构、检索过程或堆砌原始数值，除非这些细节直接影响结论或我明确要求。",
    "",
    "区分 PianoAI 数据、你的推断和其他来源；PianoAI 证据不足时简要说明，其他来源需单独标明。默认用中文回答，结尾列出实际使用的 PianoAI 数据链接。",
  ].join("\n");
}
