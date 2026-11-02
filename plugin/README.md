# @local/ai-voice-minutes · Local AI Voice Minutes

在 Harness 中使用本地会议纪要：导入音频离线转写，或采集麦克风与系统音频进行实时转写和翻译，再生成结构化纪要与问答。ASR、实时翻译、纪要生成和会议问答都默认优先使用本机模型；实时翻译在本地不可用时可自动回退到云端 MiniMax。只有主动选择远程端点或触发兜底时，对应文本才会发送到该端点。

## 安装

插件以工作区目录维护，安装由 `plugin_manager` 完成（不要手工修改 profile 的 `package.json` / `cordis.patch.yml`）：

```
plugin_manager
  action: install_bundle
  target: <本目录的绝对路径>
```

## 组成

| 文件 | 作用 |
|---|---|
| `index.js` | Host 服务、会议库、ASR/对话/翻译端点与 API |
| `live.js` | 原生采集进程适配、可配置短分段聚合与 WAV 封装 |
| `realtime.js` | 实时队列、重试、事件日志、原始 PCM 与原子检查点 |
| `client.js` | Minutes / Live 主面板与设置 |
| `native/` | macOS 麦克风 + ScreenCaptureKit 双轨采集程序 |
| `cordis.patch.yml` | 插件行 `ai-voice-minutes` |
| `locale/en.json` `locale/zh.json` | 插件显示元数据 |
| `icon.svg` | 插件图标（原创） |

## 本地服务与模型

| 用途 | 默认地址 / 模型 |
|---|---|
| ASR（OpenAI 兼容） | `http://127.0.0.1:8010/v1/audio/transcriptions` |
| 纪要与问答（本地优先） | `http://127.0.0.1:6121/v1` · `qwen3.5-9b-mtp` |
| 纪要与问答（兜底） | 设置页可另配一个端点，主模型失败时接管 |
| 实时翻译（本地优先） | `http://127.0.0.1:6121/v1` · `hy-mt2-7b` |
| 实时翻译（云端兜底） | `https://api.minimaxi.com/v1` · `MiniMax-M3.1-Flash` |

纪要和实时翻译是两套独立设置。Hy-MT 只负责翻译，结构化纪要和问答使用通用 Qwen 模型。两者都使用 `reasoning_effort: "none"` 避免把 token 消耗在推理正文上。LM Studio 不接受 `response_format: json_object` 时，插件会自动改用纯文本请求并继续解析 JSON 纪要。实时翻译可在设置页关闭云端兜底；切换到 MiniMax 时复用现有 MiniMax 凭据（当独立翻译凭据未配置时）。

**纪要兜底模型**：设置页「Minutes LLM」区块可开启兜底模型。主模型请求失败、不可达，或者答出的内容解析不出 JSON 时，插件会自动改用兜底端点，结果里带上 `provider` 与 `fallbackUsed`。主模型与兜底模型各自使用自己的 Reasoning effort —— 云端模型开着思考，不会把本地模型也拖进思考模式（实测 23s 与 173s 的差别）。兜底默认关闭，填齐提供方、模型与地址后才会启用。

## 模型配置

设置页按 **ASR、Minutes LLM、Realtime Translation** 分为三个独立区块。每个区块都有自己的提供方、Base URL、模型 ID、API Key、Temperature、Max tokens 和 Reasoning effort。截图中的通用 `API Key` 已改为明确的 `Minutes LLM API Key`；翻译使用独立的 `Translation API Key`，不会与 ASR 或纪要模型混用。

密钥分别存于 macOS 钥匙串：`ai-minutes-api-key`（纪要 LLM）、`siliconflow-api-key`（SiliconFlow ASR）、`translation-api-key`（实时翻译）。输入框留空会保留对应凭据，LM Studio 本地模式不发送 API Key。

说话人数不在设置中固定，转写服务按每场音频自动聚类识别。设置页只保留后端、模型与分段长度，**不再显示术语热词编辑框**；已有配置仍可被服务读取，不需要在界面里维护。

说话人标签来自录音里真实的人：转写服务用 ECAPA 声纹聚类，直播会议在结束时对整段音轨再跑一次聚类，把采集音轨名（`mic` / `system`）换成说话人，所以同一段对话里两个人会被分成 **Speaker A** 和 **Speaker B**。

## 本地 ASR 服务管理

插件安装和启用时**不会默认启动 ASR 服务**。在 **Settings → Local ASR service management** 可以查看服务健康状态，并执行启动、停止、重启、刷新状态，以及在 **Local model library** 下拉里下载或切换本地模型。只有勾选 **Start ASR when the plugin starts** 才会随插件启动。

模型库里的每个条目按后端各写各的设置：GGML 模型写 `whisperCppModel`，SenseVoice 写 `senseVoiceDir`，Fun-ASR-Nano 写 `funAsrDir`，切换时会同时把 `asrBackend` 改成对应后端。**ECAPA 说话人模型不是转写模型**，只提供下载，不提供"设为使用"。切换后的模型会同步回设置表单，再点 **Save settings** 不会把刚切换的模型改回去。

下载只在点击条目上的 **Download** 时进行，先写入 `.download` 临时文件，完成后原子改名，避免未完成模型被误用。服务启动使用 `--speakers 0` 自动人数识别，不注入固定领域热词。

ASR 服务代码、启动器、GGML 模型、Python 运行环境、说话人模型缓存、PID 和日志全部位于插件 `native/asr/` 内，不再依赖原业务项目目录或 `~/.cache/onerway-prototype-review`。系统级 `python3`、`whisper-cli` 和 `ffmpeg` 仍作为本机命令依赖。

## SiliconFlow 云端 ASR

在 **Settings → ASR provider** 选择 `SiliconFlow cloud` 即可切换在线转写。默认地址为 `https://api.siliconflow.cn/v1`，已验证模型：

- `XingChenAGI/XingChenASR-Diarize-V3.0`：分段与说话人识别
- `XingChenAGI/XingChenGSR-V1.0`：完整文本转写

SiliconFlow API Key 保存在 macOS 钥匙串（服务名 `siliconflow-api-key`），不写入 `settings.json`、源码或测试日志。钥匙串输入框留空会保留已有凭据。启用云端 ASR 时，音频会发送到 SiliconFlow；离线与实时转写都使用同一提供方配置。

离线 M4A/MP3 转写还需要 `ffmpeg`：插件先转换为 16 kHz 单声道 WAV，再交给 whisper.cpp。

## Live 使用

0. **同声传译** 按钮：会议工作台右上角的一键入口，跳到 Live 并**立即开始**采集、实时字幕和翻译；结束时自动生成纪要。语言方向沿用 Live 里当前选好的原文语言与译文语言（默认自动识别原文、译成英文），两者相同时按钮会给出提示而不是静默不动。
1. 打开左侧 **Minutes → Live**。Live 标题左上方有 **Back to library / 返回会议库**，点击会退出 Live 并回到会议列表。
2. 选择语言方向和音轨过滤，点击开始。
3. 麦克风与系统音频分别保存为独立 PCM 音轨；可选 `mix` 仅用于混音，不会重复转写。
4. 原生帧聚合约 10 秒后依次转写、翻译。队列、失败、降级和耗时显示在面板中。**Pause transcription** 只暂停转写，双轨录音仍继续；**Resume transcription** 恢复并处理积压片段。
5. **Desktop window** 打开独立置顶浮窗，实时显示原文和译文，可拖动、调整大小、关闭和重新打开，不影响后台录制。

## 实时字幕浮窗

浮窗默认是**一张小卡片**：只显示最新一句原文和它的译文，下方是**电平条**（按最近一段录音的响度缩放，能看出说话的轻重起伏），底栏是录制时长、暂停（蓝色）和结束（红色）两个按钮，样式和作用都不一样。

- **展开**：右上角的按钮在"卡片"和"完整对话"之间切换。完整对话是原文 / 译文两栏，**可以往上翻**回看之前的每一句；只有在已经贴到底部时才会自动跟随最新一句。
- **显示方式**：标题栏有 **Original / Translation / Both** 三档，决定卡片显示原文、译文还是两者；选译文时旁边出现语言选择器，切换后这场会议的后续字幕就改用那个语言翻译，选择会记住。
- **语音动效**：卡片底部是一条**实时波形**，每个采样是一根以中线为轴的竖条，高度就是这一刻的响度（每 30 毫秒一帧的 RMS 能量），安静时几乎是一条平线，说话时高低起伏。
- **结束中**：点停止后计时立即冻结，浮窗依次显示「正在结束 → 正在整理纪要 → 纪要已就绪」。录音先保存到会议库，纪要后台生成；完成后显示绿色完成提示，停留几秒再自动关窗。短会议不需要生成纪要时，会直接提示已保存。
- **大小和位置**：拖动标题栏移动窗口，窗口边缘可缩放。选好的大小和位置记在 `~/.ai-minutes/overlay-window.json`，下次打开还在。
- **背景颜色**：Settings → **Live transcript overlay** 里可以改浮窗的背景色、文字颜色和不透明度，默认只显示最新一句。改完立刻生效，正在开的浮窗也会跟着变。
- **按钮会真的作用到会议**：浮窗上的暂停、继续、结束直接控制这场实时会议——暂停会暂停转写，结束会停掉采集、把会议存进会议库并生成纪要。

浮窗和插件之间走 JSONL：插件通过标准输入发送 `appearance` / `session` / `state` / `level` / `transcript` / `translation` / `notice`，浮窗通过标准输出回送 `pause` / `resume` / `stop` / `language`。`notice` 的 `phase` 为 `working` 或 `ready`，用于结束后的纪要进度和完成提示。

## Transcribe 阅读布局

逐字稿使用按发言分块的阅读布局，不再使用三列表格行：蓝色数字 Speaker 徽标、姓名与时间位于同一行，原文整段展示；译文在对应原文下方以较小字号和次级颜色显示。Speaker 点击改名、内容搜索、双语开关和相对时间戳保持原有行为。

## Viewpoint Tree 脑图

观点按脑图结构展示：左侧分支线连接彩色主题胶囊与子节点，单条观点使用独立分支卡片，两条相关观点使用双栏对比卡片。主题颜色按顺序轮换并适配浅色、深色主题，立场、详情和风险信息保持完整。

## 快捷入口

会话头部右侧和文档预览工具栏各有一个 **🎤 按钮**（注册在 `conversation.session.header.utilities` 和 `sidebar.right.tab.document.actions`）：

- **还没在录音**：点一下直接开始实时采集，并把字幕浮窗打开——不用切到 Minutes 面板再点「开始实时」。
- **已经在录音**：点一下只把字幕浮窗唤回桌面前。

按钮自带样式（不依赖面板是否打开），出错时图标变红并把原因写在 tooltip 里。

## 实时字幕的速度

字幕从说话到出现要经过"收够一段音频 → 转写 → 翻译"，三步都做了压缩：

- **识别分段不等于字幕断句**：Settings → ASR 转写服务 → **Live caption chunk**，3 秒 / 5 秒 / 10 秒，默认 3 秒。短分段只负责快速出字，不再强行把一句话切成多行。字幕在同一行流式增长，遇到句号/问号/叹号、真实静音停顿、约 25 秒或 120 字才收尾；结束会议时也会把最后半句完整保存。译文跟随整句更新，旧的短译不会覆盖新的长译。最终逐字稿仍由精修模型补全。
- **翻译不再挡住下一句**：翻译和转写并行，上一句在翻译时下一句已经在转写了。
- **翻译并发 8 路**：多句同时翻译，不再一句接一句排队；译文仍按句子顺序发布，读起来不会乱。云端单句要 1–7 秒，串行时三句就会堆到 20 秒以上。
- **流式翻译**：译文**逐字出现**，不用等整句写完。模型每吐出一段就下发一次，字幕边写边长。聊天端点不支持流式时自动退回整句返回。
- **本地模型优先**：默认先用本机 LM Studio 的翻译模型（免掉公网往返），云端 MiniMax 作为兜底。实测热态短句 **158ms**（本地）对 3201ms（云端），5 秒分段 372–548ms 对 915–1580ms，本地快 3–10 倍。
- **电平信号走单独通道**：浮窗的音量条每秒更新十几次，不占用转写队列。
6. **End meeting** 停止采集并等待已接收片段处理完成，随后刷新会议库并自动打开这场会议。原始 PCM、`events.jsonl` 与 `checkpoint.json` 位于 `~/.ai-minutes/realtime/<session-id>/`，历史实时会话也会出现在会议库中。录制中的会议在**会议详情页**里同样显示「录制中」和 **End meeting**，不用先跳回 Live 才能结束。
7. 会议结束时会对整段录音做一次说话人聚类，把分段上的 `mic` / `system`（采集音轨，不是人）换成真实说话人；短录音当场完成，长录音在后台完成并写回会议记录，页面会自动刷新说话人标签。
8. 删除会议会同时删除会议 JSON、实时会话目录及其中的音轨、日志和检查点；离线导入音频通过 `audioId` 精确删除。若记录不存在，会显示错误而不是假成功。

macOS 权限：

- 麦克风：**System Settings → Privacy & Security → Microphone**
- 系统音频：**System Settings → Privacy & Security → Screen & System Audio Recording**（旧版本称 Screen Recording）

权限通常归属于 DeepSeek Harness 或启动采集的宿主进程。修改权限后需要重新启动该进程。采集程序不会改变系统默认输入/输出设备或音频路由。

原生程序源码位于 `native/`，可用 `native/build.sh` 重新构建。

## 接口

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/ai-minutes` | POST | `health` / `settings` / `transcribe` / `summarize` / `ask` / `list` / `get` / `save` / `delete` / `live-start` / `live-status` / `live-pause` / `live-resume` / `live-stop` / `live-overlay-open` / `audio-list` / `audio-delete` |
| `/api/ai-minutes/audio` | POST | 原始音频字节上传，避免长录音变成 JSON 字符串 |
| `/api/ai-minutes/live-audio?id=<session>&track=<mic|system|mix>` | GET | 将当前 PCM 音轨以流式 WAV 返回，用于底部播放控制，不把整段音频读入内存 |
| `/api/ai-minutes/meeting-audio?id=<audio-id>` | GET | 会议录音流式回放 |

两个回放路由都支持 HTTP Range（`206 Partial Content`），所以播放器可以拖动进度条跳到任意位置，不用先下载整段录音。

## 音频资源管理

会议详情页的播放器里有一行紧凑的音频控件（不再是单独的大卡片）。播放/暂停按钮就在进度条左边，不再单独占一行。

| 类型 | 用途 | 下载 | 删除 |
|---|---|---|---|
| 完整音频 | 默认播放整场录音，直播会议把麦克风和系统音轨**逐样本平均混音**成 `meeting.wav` | 完整 WAV（不是分轨文件） | 是 |
| 麦克风 / 系统音轨 | 需要单独试听某一轨时在音频下拉框里切换 | 也统一给出上面的完整 WAV | 是 |
| 原始音频 | 导入时上传的文件，`~/.ai-minutes/audio/` | 原始格式 | 是 |

只有一条音轨时，完整下载就直接使用那一条；两条都在时才做混音。删除只删音频文件，逐字稿、翻译和纪要全部保留；删掉上传的原始音频还会把会议记录里的 `audioId` 清空，播放器随之失效。

浮窗底部的波形用每帧 PCM 的 **RMS 能量**决定幅度和形状：声音越大波形越高，轻声或安静时接近一条直线，不再按窗口最大值把安静和响亮都归一化成一样高。

## 声音库

点击会议播放器里的 **N 位说话人 / N speakers** 会展开本场说话人列表。选择 Speaker A/B/C 或已识别姓名即可标注、修正姓名；保存后，会议记录里的 `speakerProfiles` 关联到全局声纹档案，后续会议会用同一套 ECAPA 声纹匹配自动显示标注人信息。给未命名声纹首次命名会更新原档案；把已命名但识别错误的说话人改成另一人时，会改派到目标声纹或新建独立档案，**不会重命名或重训原说话人的档案，也不会改写其历史会议**。需要全局改名时，使用声音库里的「重命名声音」。旧实时会议缺少声纹时，保存标注会先利用保留音轨自动补做说话人分离，再继续保存；只有音轨不存在或分离失败时才报错，并保留输入草稿。

每个 Speaker 名前都有独立播放按钮，用于播放该说话人在本场录音中的首个语音片段。样本直接来自当前会议分段，因此旧会议尚未生成永久声纹时也能试听；播放从片段起点开始、到终点自动停止，使用独立音频元素，不会启动或改写整场播放器的状态。无法取得样本时会在弹层内说明原因。

顶部的 **Voice book** 按钮使用紧凑管理面板：点击后在按钮下方弹出，顶部搜索和 All / Named / Unnamed 筛选，已命名声纹优先，未命名默认折叠；播放与重命名使用统一 SVG 控件，重命名支持纯图标保存和取消。搜索同时匹配命名与未命名声纹，筛选 Unnamed 时直接展示结果，底部保留永久存储与备份说明。点击外部或按 Esc 关闭面板，Voice book 也不再占用 AI 助手抽屉空间。

**原始录音与声纹档案的生命周期不同**：原始音频、麦克风/系统音轨仍可删除；提炼出的声纹档案不提供删除入口或删除 API，删除会议和录音也不会清理声纹。主文件为 `~/.ai-minutes/voices/profiles.json`。声纹库的读取、匹配、修改与写回在同机串行执行，避免并发覆盖；每次变更先写入 `~/.ai-minutes/voices/backups/profiles-<revision>-<timestamp>-<uuid>.json` 独立备份，再原子替换主文件。备份带单调递增版本号且不自动清理，主文件丢失或损坏时按版本读取最新有效备份；旧版声纹主文件首次读取时会自动补齐一次备份。Live 会议在结束分离说话人后也会保存对应声纹，不只保存 Speaker A/B/C 文本标签。

声音库里的每个声音都带一段可播放的样本：会议保存时会按说话人把录音里的一小段挂到声音档案上，播放时从样本起点开始、到样本终点自动停。没有样本的声音，点播放会直接在声音库里说明原因，而不是毫无反应。样本只是原始录音的引用；删除对应录音后，永久保留的声纹向量与姓名仍可用于识别，但旧样本可能无法再播放。

样本的时间是**音轨内的时间**（直播会议从录音开头算起），不是墙上时钟，所以永远落在音频范围内。

Agent 命令：`minutes-transcribe`、`minutes-summarize`、`minutes-ask`。

## 测试

```
node --expose-gc --test tests/*.test.mjs
python3 -m unittest discover -s tests/native-audio -v
python3 -m unittest discover -s tests/native-overlay -v
native/bin/floating-overlay --self-test
```

覆盖 API 契约、配置隔离、低延迟翻译、WAV 转换、音频聚合、实时队列、重试、原始音轨与检查点、队列上限、停止清理、双语 UI 与轮询生命周期，以及原生协议。

## 数据与密钥

- 会议库：`~/.ai-minutes/meetings/`
- 实时会话：`~/.ai-minutes/realtime/`
- 导入音频：`~/.ai-minutes/audio/`
- 助手问答历史：`~/.ai-minutes/assistant/history.json`
- 声音标签库：`~/.ai-minutes/voices/profiles.json`
- 声纹永久备份：`~/.ai-minutes/voices/backups/`
- 设置：`~/.ai-minutes/settings.json`
- MiniMax API Key 存 macOS 钥匙串（服务名 `ai-minutes-api-key`），不写入设置文件；非 macOS 才使用兼容回退

## 持久化

| 内容 | 存储位置 | 写入时机 |
|---|---|---|
| 会议音频（导入） | `~/.ai-minutes/audio/audio-<id>.<ext>` | 选择文件后立即上传落盘 |
| 会议音频（实时） | `~/.ai-minutes/realtime/<id>/{mic,system,mix}.pcm` | 采集过程中持续写入原始 PCM |
| 逐字稿与分段 | `~/.ai-minutes/meetings/<id>.json` | 实时会议在结束瞬间写入；离线转写完成后自动写入 |
| AI 纪要（摘要/议题/决策/待办） | 同上 `minutes` 字段 | 点击生成纪要后立即写入 |
| 实时事件日志与检查点 | `~/.ai-minutes/realtime/<id>/events.jsonl`、`checkpoint.json` | 采集与转写过程中持续追加 |
| 单会议问答 | 会议记录的 `qa` 字段 | 提问后立即写入 |
| 跨会议助手问答 | `~/.ai-minutes/assistant/history.json` | 每次提问后追加 |
| 收藏、标签、时长、创建人 | 会议记录字段 | 修改即写入 |
| 声纹向量、姓名与样本引用 | `~/.ai-minutes/voices/profiles.json` | 自动聚类或修正标注后写入；永久保留 |
| 声纹历史快照 | `~/.ai-minutes/voices/backups/` | 每次声纹库变更先写独立备份，不自动清理 |

关闭浏览器、重启应用或重启电脑都不会丢失上述内容；删除会议时会同时删除其音频与实时会话目录，但不会删除声纹主文件或任何声纹备份。

## 当前范围（v2.5.1）

- 设置按 ASR / Minutes LLM / Realtime Translation 分类，Live 的队列与延迟等诊断信息默认折叠，保留明确的录制状态。
- 会议卡片可直接收藏；「待生成纪要」统计不再把仍在录制的会议计入。

- 首页改为任务优先的浅色工作台：唯一主操作「开始会议」、次操作「导入音频」、会议/时长/纪要状态统计，以及默认紧凑会议卡片；模板墙与重复 Create minutes 入口移除。
- AI 助手改为按需右侧抽屉，首页与详情页默认不占用阅读宽度；声音库与历史问答仍在抽屉内可用。
- 详情页改为居中阅读工作区，模板选择移动到生成/重新生成纪要旁；Live 双栏与录音生命周期保持不变。
- 实时翻译与纪要问答均默认本地优先：Hy-MT2 负责翻译，通用 Qwen 负责纪要和问答；MiniMax 仅作为实时翻译的可关闭兜底。本地模型使用低延迟配置。

## 当前范围（v1.9）

- Live 工作室按参考重做：顶部原文/译文语言选择、隐身模式徽标、设置入口，底部悬浮控制条（录音呼吸点、计时、笔记、旗标、暂停转写、结束会议）
- 转写逐行显示原文与下方强调色译文，笔记/旗标行内渲染
- 右侧「Real-time Summary」：显示**真正总结出来的内容**（背景、要点、结论、行动项），待生成时是骨架微光动画，右上角可以选择总结语言，切换后会重新生成一份该语言的总结。逐字稿里的原话只在「Notes」页出现，标点和单字这类噪声不会进总结。
- 会议库按参考重做：模板选择卡片、Recent/Created/Shared/Favorite 页签、列表/网格切换、进行中会议脉冲徽标与「回到实时」入口、Ask AI 侧栏
- 翻译端点不可达时自动重试并收敛为一条带端点地址与重试按钮的提示条，不再逐行刷屏
- 中断恢复：插件重载或 Host 异常退出后，启动时自动把已结束的实时会话整理成会议记录，录音与逐字稿不会丢
- Hy-MT2 支持：提示词不再用反引号包裹原文（模型会照抄格式），译文统一去除反引号、引号与「译文：」等前缀；模型对比按各自模型选择提示词
- 修复会议库表格错位：行与表头统一为 8 列（选择、标题、创建时间、时长、创建人、来源、大小、操作），大小按 KB/MB 显示，窄屏横向滚动，网格视图改为卡片排布

- 适配腾讯 Hy-MT2 专用翻译模型：自动识别模型并使用官方提示词格式，支持术语表（Glossary）注入对齐业务术语
- 提示词格式可手动切换：自动识别 / 通用大模型 / Hy-MT 专用

- 翻译模型对比：同一批真实会议句子分别过两个模型，输出译文、平均耗时，并自动标记「多余说明」和「空结果」，用于在下载新模型后做客观选型

- 翻译模型可直接切换为任意 OpenAI 兼容端点上的模型：设置中「读取可用模型」即可列出服务端模型并选择
- 对不接受 `reasoning_effort` 的后端自动降级重试，避免切换模型后翻译直接失败

## 切换翻译模型

1. 先让模型在本地服务上就绪，例如在 LM Studio 中加载 `unsloth/Qwen3.6-35B-A3B-GGUF`（M4 Max 128 GB 建议 `UD-Q5_K_M`，约 28 GB）。
2. 在 **Settings → Realtime Translation** 填写 Base URL（如 `http://127.0.0.1:6121/v1`）。
3. 点击 **读取可用模型**，从下拉框选择服务端实际暴露的模型 ID。
4. 保持 **Reasoning effort = 关闭推理（none）** 以获得实时翻译延迟；若服务端不支持该参数，插件会自动去掉后重试。

注意：模型 ID 以服务端返回值为准（例如 LM Studio 通常返回 `qwen3.6-35b-a3b`，而不是仓库全名）。

5. 可点击 **对比翻译模型**，用当前会议的真实句子同时跑当前模型与服务端其他模型，对比译文、平均耗时，并标记出「多余说明」或「空结果」的模型。

### 使用腾讯 Hy-MT2（推荐用于翻译）

Hy-MT2 是专用翻译模型，支持 33 种语言、Apache-2.0，官方提供 GGUF，社区提供 MLX 版本：

| 用途 | 模型 | 体积 |
|---|---|---|
| 先跑通流程 | `mlx-community/Hy-MT2-1.8B-4bit` | 约 1.0 GB |
| 日常推荐 | `mlx-community/Hy-MT2-7B-4bit` | 约 4.2 GB |
| 更高精度 | `mlx-community/Hy-MT2-7B-8bit` | 约 8.0 GB |
| llama.cpp | `tencent/Hy-MT2-7B-GGUF`（Q4_K_M / Q6_K / Q8_0） | 约 4.5–8.5 GB |

部署方式二选一：

- **LM Studio**：直接导入 MLX 仓库并在本地服务器加载，Base URL 仍为 `http://127.0.0.1:6121/v1`。
- **mlx_lm.server**：`python3 -m mlx_lm.server --model mlx-community/Hy-MT2-7B-4bit --port 8080`，Base URL 填 `http://127.0.0.1:8080/v1`。建议为它单独建虚拟环境，当前系统 Python 的 `transformers` 与 `tokenizers` 版本冲突会阻止 `mlx_lm` 启动。

插件会自动识别模型名并切换到 Hy-MT 官方提示词格式；在 **Settings → Realtime Translation → 术语表** 中按 `进件 = onboarding` 的格式逐行填写业务术语，翻译时会按术语表对齐。

本机已接入 `Tencent-Hunyuan/Hy-MT2-7B-GGUF`（`Hy-MT2-7B-Q4_K_M.gguf`），由 LM Studio 在 `http://127.0.0.1:6121/v1` 提供服务，服务端模型 ID 为 `hy-mt2-7b`。实测真实会议句子平均 447ms、无多余说明、无空结果。

- 修复：保存设置不再把点击事件当作设置内容提交（曾导致 JSON 序列化失败），失败时给出可读提示
- 修复：本地 ASR 启停失败时说明原因与排查位置（启动脚本、模型目录、日志目录）

- 声音打标：ASR 输出每个说话人的声纹，跨会议自动匹配；为说话人命名后写入全局声音标签库，之后的会议会自动认出同一个人

- 右侧常驻「Ask AI」栏：能力入口（议题导图 / 关键洞察）、近期会议总结、随会议内容动态生成的「你可能想问」、消息流与底部固定提问框

- 全链路持久化：导入音频、实时原始音轨、逐字稿、AI 纪要、单会议问答与跨会议助手问答全部落盘，转写与生成纪要后自动保存

- 会议库表格：缩略图、标题/摘要、创建时间、时长、创建人、来源和大小
- 详情页：面包屑、收藏、编辑、翻译、分享、搜索、播放器（拖动进度、±15 秒、倍速）
- 右侧常驻栏：近期会议总结（可直接切换会议）与 AI 会议助手
- AI 会议助手基于历史会议的逐字稿与纪要回答问题，给出可执行工作建议，并标注引用来源
- 四类视图：Transcribe、AI Summary、Viewpoint Tree、Chapter，支持大纲跳转和章节详情
- 多语言逐行翻译：进度动画、译文逐行显示在原文下方，使用差异化字体、颜色和左侧标识
- 多语言翻译与双语显示、内容搜索、标题/逐字稿编辑保存
- 分享链接与真实 Markdown、JSON、WAV 导出
- 离线音频转写、逐字稿、结构化纪要、会议库与问答
- 实时麦克风与系统音频双轨采集、10 秒分片转写和独立翻译
- 原始音频持久化、事件日志、原子检查点、重试、队列上限与降级提示
- 持续两小时稳定性以实际 soak 测试记录为准

对应需求与方案：`platform/prd/ethan/ro-tbd-local-ai-voice-minutes/`
