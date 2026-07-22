# PianoAI

PianoAI 是一个在浏览器中使用的钢琴练习与谱面研究工具。它把可交互的乐谱、结构分析和专业录音对比放在同一个界面中，帮助使用者练习作品、理解写作结构，并观察不同演奏家的处理方式。

当前曲库包含 7 首内置作品、7 份静态乐谱分析和 41 份专业录音演绎记录。

## 功能

### 练习模式

- 从内置曲库选择作品，或导入本地 `MusicXML`、`XML`、`MXL` 文件。
- 左右手可分别设置跟弹，通过键盘或 MIDI 设备逐音、逐和弦导航。
- 点选或框选乐谱设定练习区间，可以循环练习或播放。

### 分析模式

- 查看曲式分段、主题与动机，以及左手和弦和复调织体。
- 在分析条目与乐谱之间双向定位，快速跳转到对应小节。
- 选中分析范围后直接播放，结合听觉和谱面理解作品。

### 演绎模式

- 在同一作品赏析对比不同钢琴家的演奏。
- 在谱面上直观地查看速度、力度、时值、和弦时序、踏板和装饰音等演绎信息。
- 在机械原谱、标准化演绎和原始录音之间随时切换，让你最直观地感受钢琴家的演绎。

> 本地导入的谱面仅用于练习。谱面分析和专业演绎依赖预先校验的数据，因此目前只适用于内置曲目。

## 快速开始

需要 Node.js `^22.12.0` 或 `>=24.0.0`，以及 npm 10 或更高版本。

```powershell
npm ci
npm run dev
```

浏览器打开 `http://127.0.0.1:5173`。开发模式会优先读取本地参考音频；本地文件不存在时，再从已配置的 R2 地址加载。普通使用和前端开发不需要安装 Python、CUDA 或转录模型。

## 技术栈

- React 19、TypeScript 6 和 Vite 8 构建前端应用。
- OpenSheetMusicDisplay 渲染 MusicXML，Tone.js 和 Web MIDI 提供播放与设备交互。
- Vitest 和 jsdom 负责自动化测试，AJV 负责数据结构校验。
- Python、FFmpeg、PyTorch、Piano Transcription Inference 和 Synctoolbox 用于离线生成演绎数据；Cloudflare R2 托管公开参考音频。

## 开发与验证

| 命令 | 用途 |
| --- | --- |
| `npm run check` | 运行全部数据校验、自动化测试和类型检查 |
| `npm run build` | 构建使用 R2 参考音频的线上版本 |
| `npm run build:local` | 构建只使用本地参考音频的版本 |
| `npm run performance:setup` | 创建演绎处理所需的 Python 环境并安装依赖 |
| `npm run performance:doctor` | 检查 Python、FFmpeg、模型和 GPU/CPU 运行环境 |

线上构建需要显式提供参考音频地址：

```powershell
$env:VITE_REFERENCE_AUDIO_BASE_URL = 'https://assets.piano.2226.love/'
npm run build
```

离线转录会优先使用 NVIDIA CUDA；没有可用 GPU 时自动回退到 CPU。CPU 可以完成处理，但大型录音耗时会明显增加。安装方式和故障排查见 [演绎工具说明](tools/performance/README.md)。

## 项目结构

- `src/`：React 应用、乐谱交互、播放与分析界面。
- `data/`：内置曲目目录、静态分析和专业演绎记录。
- `assets/`：可选的本地参考音频。
- `schemas/`：分析与演绎数据的 JSON Schema。
- `tools/`：谱面提取、分析校验、演绎处理和部署工具。
- `.agents/skills/`：可重复执行的数据导入、谱面分析和参考演绎工作流。

## 数据维护

内置谱面遵循“导入标准谱面 → 提取确定性事实 → 编写并校验静态分析 → 注册曲库”的流程；参考演绎遵循“登记来源 → 转录 → 全曲对齐与评估 → 生成演绎记录 → 发布音频”的流程。这些任务都在离线工具中完成，不会增加浏览器运行负担。

具体规范见 [AGENTS.md](AGENTS.md)，可执行步骤见 [`piano-score-ingestion`](.agents/skills/piano-score-ingestion/SKILL.md)、[`piano-score-analysis`](.agents/skills/piano-score-analysis/SKILL.md) 和 [`piano-reference-performance`](.agents/skills/piano-reference-performance/SKILL.md)。

## 许可

项目代码与项目自制数据采用 [MIT License](LICENSE)。第三方乐谱与录音仍受各自来源条款约束；来源和版权信息记录在相关曲目及演绎元数据中。
