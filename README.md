# PianoAI

PianoAI 是一个基于 MusicXML / MXL 的钢琴练习、乐谱分析和专业演绎对比应用。

## 产品功能

- 练习：加载内置曲库或导入本地 MusicXML / MXL，选择左右手、逐音导航、框选范围、调整速度、使用 MIDI 输入并播放多采样钢琴音源。
- 分析：显示内置曲目的曲式段落、动机家族和左手和弦或复调纹理，支持定位、选段与跟随播放。
- 演绎：按同一谱面坐标比较专业录音的速度、力度、时值、和弦时差和踏板，并在原始录音与统一音源标准化播放之间切换。

导入的外部谱面可以使用练习功能；静态分析和专业演绎只对 `data/catalog.json` 中的内置曲目开放。

## 目录职责

- `src/`：React 应用、领域逻辑和随应用发布的 Salamander 钢琴采样。
- `data/`：受版本控制的产品数据。包含谱面、静态分析、演绎 catalog、演绎详情和自动评价。
- `schemas/`：静态分析与专业演绎的数据契约。
- `tools/`：谱面检查，以及参考录音采集、对齐、生成、校验和 R2 同步工具。
- `assets/`：只保存本机参考源录音，整个目录不进入 Git。
- `.agents/`：代理工作流、说明、模板和参考资料，不拥有项目运行程序。
- `.local/`：本机长期模型与 Python 环境，不进入 Git。
- `.cache/`：可随时删除并重新生成的 facts、转录、报告和构建缓存。
- `dist/`：构建产物，不进入 Git。

项目不再使用根 `public/` 或 `analysis/`。Vite 只发布 catalog 引用的运行时数据；`data/performances/evaluations/` 只参与构建校验，不进入浏览器产物。

## 开发与校验

```powershell
npm install
npm run dev
```

```powershell
npm run analysis:validate
npm run performance:validate
npm test
```

`npm run dev` 直接从 `assets/reference-audio/` 提供参考录音，并支持 HTTP Range 请求。

## 构建目标

本地完整构建会校验并复制 catalog 引用的参考录音：

```powershell
npm run build:local
npm run preview
```

在线构建不读取、不校验也不复制 `assets/`。它要求配置 R2 公共 HTTPS 基址：

```powershell
$env:VITE_REFERENCE_AUDIO_BASE_URL = "https://media.example.com/"
npm run build
```

浏览器会把 catalog 中的内容寻址 `objectKey` 拼到该基址后。录音内容变化会产生新 key，因此 R2 对象可以使用一年 `immutable` 缓存。

## Cloudflare R2

先校验本地 41 份录音，再同步到 R2：

```powershell
$env:R2_BUCKET = "pianoai-media"
npm run performance:r2:sync -- --dry-run
npm run performance:r2:sync
npx wrangler r2 bucket cors set $env:R2_BUCKET --file tools/performance/config/r2-cors.json --force
```

同步工具使用 Wrangler 上传 catalog 引用的对象，设置正确 MIME 和 `Cache-Control: public, max-age=31536000, immutable`。R2 的 CORS 模板位于 `tools/performance/config/r2-cors.json`；生产环境应把 `AllowedOrigins` 从 `*` 收紧为正式站点域名。Cloudflare Pages 只部署 `dist/`，`VITE_REFERENCE_AUDIO_BASE_URL` 配置为 R2 自定义域名或公开访问域名。

专业演绎生成环境、数据边界和命令见 `tools/performance/README.md`。
