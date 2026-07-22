# 专业演绎流水线

本目录只保存生成、采集、校验和部署工具；正式数据统一保存在 `data/performances/`，参考源录音统一保存在被 Git 整体忽略的 `assets/reference-audio/`。

## 数据流

```text
data/scores/<score-id>.mxl
  + assets/reference-audio/<file>
  -> FFmpeg 标准化
  -> Synctoolbox 全曲同步
  -> Piano Transcription Inference 音符与踏板候选
  -> 谱面约束的逐音符匹配与自动能力门控
  -> data/performances/evaluations/<interpretation-id>.json
  -> data/performances/interpretations/<interpretation-id>.json
```

规范谱面决定音高、顺序和结构。转录模型只提供起音、离键、力度、踏板和装饰音候选。演绎详情通过 `evaluationId + evaluationSha256` 引用评价，不保存仓库路径。

## 数据职责

- `data/performances/catalog.json`：来源、演奏者、录音身份、本地文件名和 R2 object key。
- `data/performances/interpretations/`：浏览器加载的 timeMap、音符表达、踏板和生成摘要。
- `data/performances/evaluations/`：构建校验读取的离线对齐证据，不发布到浏览器。
- `tools/performance/config/reference-sources.json`：可自动采集的来源计划。
- `assets/reference-audio/`：本机原始录音；不是缓存，必须在工作区外或 R2 保留备份。
- `.cache/performance-tests/`：可以重新生成的转录、对齐和模型中间结果。
- `.local/`：长期 Python 环境与模型权重。

## 常用命令

```powershell
npm run performance:setup:alignment
npm run performance:collect
npm run performance:generate:planned
npm run performance:generate
npm run performance:generate:cached
npm run performance:validate
npm run performance:finalize
```

生成单个演绎：

```powershell
npx tsx tools/performance/generate-reference-performance.ts `
  --reference <interpretation-id>
```

来源索引和风格报告写入 `.cache/reports/performance/`。生成命令只会写入 `data/performances/`，不会重建旧 `public/` 或 `analysis/` 目录。

## 本地资产与 R2

`npm run dev` 直接流式读取本地录音；`npm run build:local` 校验 SHA-256 后复制到本地构建；`npm run build` 只生成使用 R2 基址的在线包，不访问 `assets/`。

R2 object key 由录音 SHA-256 和扩展名构成。使用 `npm run performance:r2:sync -- --dry-run` 可先完成全量本地哈希检查，再执行正式同步。CORS 模板位于 `config/r2-cors.json`，线上应限制允许的来源域名，并保留 `Range`、`Content-Range` 和 `Accept-Ranges` 相关头。

长期环境位置：

```text
.local/score-alignment
.local/amt-piano-transcription
.local/amt-models/piano-transcription-note-pedal.pth
```
