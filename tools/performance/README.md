# 专业演绎流水线

本目录负责参考录音的来源采集、环境安装、GPU/CPU 转录、全曲同步、谱面约束匹配、自动评价、标准化演绎生成、校验、比较报告和 R2 同步。正式记录位于 `data/performances/`，原始参考录音位于被 Git 忽略的 `assets/reference-audio/`。

仓库只发布来源 catalog 和项目生成的学习参考数据，不发布来源录音。

## 首次安装

系统前置条件：Python 3.10-3.12、FFmpeg、FFprobe。NVIDIA GPU 可选；没有 GPU 时安装器自动选择 CPU 版 PyTorch。

```powershell
npm ci
npm run performance:setup
npm run performance:doctor
```

`performance:setup` 是幂等命令，会创建：

- `.local/score-alignment`：Synctoolbox 1.4.2 和 yt-dlp 2026.7.4。
- `.local/amt-piano-transcription`：PyTorch 2.10.0 与 Piano Transcription Inference 0.0.6。
- `.local/amt-models/piano-transcription-note-pedal.pth`：官方 checkpoint，固定大小 171,966,578 字节并校验 MD5。

GPU 机器安装 `cu128` wheel，CPU 机器安装 CPU wheel。运行时默认设备为 `auto`：`torch.cuda.is_available()` 为真时使用 CUDA，否则使用 CPU。`performance:doctor` 会实际加载 checkpoint，并输出 PyTorch/CUDA 版本、GPU 名称、所选设备、FFmpeg/FFprobe、Synctoolbox、yt-dlp 和权重状态。

强制安装 CPU runtime：

```powershell
npm run performance:setup:transcription -- --device cpu
```

仅对一次生成强制 CPU：

```powershell
$env:PIANOAI_TRANSCRIPTION_DEVICE = "cpu"
npx tsx tools/performance/generate-reference-performance.ts --reference <interpretation-id>
```

强制 CUDA 时若环境不可用会直接失败：

```powershell
npm run performance:setup:transcription -- --device cuda
```

PyTorch 安装原则参考[官方本地安装说明](https://docs.pytorch.org/get-started/locally/)，模型接口、CUDA/CPU 设备参数和官方权重来源见 [Piano Transcription Inference](https://github.com/qiuqiangkong/piano_transcription_inference)。

## 数据分层

```text
来源链接或授权本地录音
  -> tools/performance/config/reference-sources.json
  -> assets/reference-audio/<file>.m4a
  -> data/performances/catalog.json
  -> .cache/performance-tests/<interpretation-id>/source-mono-22050.wav
  -> Piano Transcription Inference 音符/踏板候选
  -> Synctoolbox 全曲同步
  -> 谱面约束逐音符匹配与自动能力门控
  -> data/performances/evaluations/<interpretation-id>.json
  -> data/performances/interpretations/<interpretation-id>.json
  -> .cache/reports/performance/
```

- `reference-sources.json`：可重复采集的来源计划，不是运行时 catalog。
- `catalog.json`：录音来源、演奏者、规范谱面、原始音频事实和内容寻址 object key。
- `evaluations/`：离线对齐证据和限制；构建时校验，不发布到浏览器。
- `interpretations/`：浏览器加载的 time map、音符表达、踏板和生成元数据。
- `.cache/performance-tests/`：单声道音频、模型转录、谱面事件和同步中间结果，可重建。
- `.cache/reports/performance/`：来源索引和跨演奏风格摘要，可重建。

规范 MXL 决定音高、顺序、结构与坐标。转录模型只提供起音、离键、力度、踏板和装饰音候选。演绎通过 `evaluationId + evaluationSha256` 引用离线评价；评价哈希按 LF 规范化，避免 Windows CRLF 造成假失配。

## 添加一个参考录音

1. 确认目标 `scoreId` 已在 `data/catalog.json`，静态分析全量通过。
2. 核实演奏者、作品、录音边界、稳定链接和处理授权。
3. 在 `reference-sources.json` 增加唯一的 `interpretationId`、`scoreId`、演奏者、`.m4a` 文件名、来源标题和 URL。
4. 采集单条来源：

```powershell
npx tsx tools/performance/collect-reference-audio.ts `
  --reference <interpretation-id>
```

5. 检查 catalog 的 `sourceHash`、URL、音频 SHA-256、时长、采样率、声道和 object key，并试听首尾。
6. 先生成单条：

```powershell
npx tsx tools/performance/generate-reference-performance.ts `
  --reference <interpretation-id>
```

7. 审查 evaluation 的有效区间、相似度、覆盖率、残差、extra/uncertain events 和 limitations，再审查 interpretation 的 time map、力度、时值、踏板和装饰音。
8. 完成校验与报告：

```powershell
npm run performance:validate
npm run performance:finalize
npm test -- --run
npm run build:local
```

完整 Agent 执行顺序见 `.agents/skills/piano-reference-performance/SKILL.md`。

## 批处理与缓存

```powershell
npm run performance:generate:planned
npm run performance:generate:planned -- --workers 2
npm run performance:generate
npm run performance:generate:cached
```

`generate:planned` 默认单 worker，并跳过已有 evaluation + interpretation 的计划项。只有实测显存余量充足时才提高 worker；多进程会各自加载一份 CUDA 模型。

以下任一变化都必须丢弃旧转录/同步缓存：音频字节或裁切、MXL 或 `sourceHash`、FFmpeg 规范化、PyTorch/模型/checkpoint、同步特征、匹配算法、门控策略。`generate:cached` 只适用于这些输入全部未变的情况。

## 本地与在线音频

`npm run dev` 优先流式读取本地录音，缺失时按 catalog 的 `objectKey` 回退到 R2；开发服务器固定在 `http://127.0.0.1:5173/`，对应 Origin 必须出现在 R2 CORS policy 中。`npm run build:local` 仍会严格校验 SHA-256 并复制 catalog 引用的全部本地音频；`npm run build` 不访问 `assets/`，只生成使用 `VITE_REFERENCE_AUDIO_BASE_URL` 的线上包。

R2 object key 由音频 SHA-256 和扩展名生成。同步前必须先 dry run：

```powershell
$env:R2_BUCKET = "piano"
npm run performance:r2:sync -- --dry-run
```

正式同步、CORS 或部署属于外部写操作，需明确授权。CORS 模板位于 `config/r2-cors.json`，线上必须保留 Range 请求相关头。

## 故障排查

- `Missing ... environment`：运行 `npm run performance:setup`。
- `cudaAvailable: false`：查看 `performance:doctor`；无兼容 GPU 时继续使用 CPU，不要手工伪造 CUDA 状态。
- checkpoint 校验失败：重新运行 `performance:setup:transcription`，安装器会重新下载并验证。
- yt-dlp 或 Synctoolbox 缺失：运行 `performance:setup:alignment`。
- audio hash mismatch：本机录音不是 catalog 记录的原始字节，先确认来源，不要只更新哈希掩盖变化。
- evaluation hash mismatch：确认内容是否真实变化；换行差异由 canonical text hash 自动处理。
- 复用缓存后结果异常：删除对应 `.cache/performance-tests/<interpretation-id>/` 并重新生成。
