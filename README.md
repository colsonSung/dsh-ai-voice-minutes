# AI Voice Minutes for DeepSeek Harness

Record a meeting, and let your own machine turn it into minutes you can act
on. The plugin captures microphone **and** system audio, transcribes it
offline, translates it live in a floating window that floats above every
other app, and writes structured minutes — topics, decisions, action items,
risks — that you can then ask questions about.

Nothing has to leave the machine. The transcription runs locally, the
translation runs on a local model, and the minutes run on a local model too.
Point it at a cloud model only if you want to.

> 中文说明：录音（麦克风 + 系统音频）→ 本机离线转写 → 悬浮窗实时双语字幕 →
> 结构化会议纪要（议题 / 结论 / 决策 / 待办 / 风险）→ 跨会议问答。默认全部在
> 本机完成，音频不上传。完整的中文技术文档见 [`plugin/README.md`](plugin/README.md)。

## What it does

| | |
| --- | --- |
| **Capture** | Microphone and system audio at the same time, through a native Swift helper that never routes audio through the system mixer. |
| **Transcribe** | Offline speech-to-text: `whispercpp` (large-v3), SenseVoice, or FunASR — all local. |
| **Translate live** | A floating window, always on top, showing the original and the translation side by side while the meeting is still running. |
| **Minutes** | One click produces structured minutes: summary, topics, chapters, viewpoints, decisions with owners and dates, action items, disputes and risks. |
| **Ask** | Question any meeting, or all of them, and get an answer that cites what was actually said. |
| **Library** | Every recording is kept in one library, searchable, with playback, export, and a delete that leaves the transcript alone. |

## Requirements

- macOS 13 or later (the capture helper and the floating overlay are Swift).
- Xcode with `swiftc` on the path, **or** the prebuilt binaries shipped in
  `plugin/native/bin/`.
- A local ASR model, a local translation model and a local chat model — see
  [Model setup](#model-setup).

## Install

```sh
git clone https://github.com/colsonSung/dsh-ai-voice-minutes.git
cd dsh-ai-voice-minutes
./install.sh          # the profile the running Harness uses
./install.sh web      # a named profile
```

The script installs the package into the profile and adds the bundle row to
the profile's patch layer. Both steps are idempotent. **Restart the Harness
afterwards** — the host half of a plugin is loaded at start-up.

## Model setup

The plugin talks to three separate services, and each one is configured in
its own section of the settings panel.

| Service | What it needs | Notes |
| --- | --- | --- |
| **ASR** | A local server on `http://127.0.0.1:8010` | `whispercpp` ships a model path in the settings; SenseVoice and FunASR run from `plugin/native/asr/`. |
| **Realtime translation** | An OpenAI-compatible endpoint | `Hy-MT2-7B` is the local default; a cloud model can take over when the local one is unreachable. |
| **Minutes & Q&A** | An OpenAI-compatible endpoint | A local Qwen model by default, with a cloud model and a second local model as fallbacks. |

Everything speaks the OpenAI chat-completions dialect, so LM Studio, llama.cpp
and vLLM all work. Cloud endpoints need an API key, which is stored in the
**macOS keychain** — never in the settings file and never in the browser
bundle.

## How it stays local

- Audio is captured by a native helper and written to `~/.ai-minutes/` as
  PCM; it is never uploaded by the plugin.
- Transcription and translation run against the endpoints you configure. A
  cloud endpoint only ever receives the text you asked it to translate.
- The minutes model writes back into `~/.ai-minutes/meetings/`.
- There is no telemetry, no analytics and no crash reporting.

See [`SECURITY.md`](SECURITY.md) for the full picture.

## Layout

```
install.sh              install into a Harness profile
plugin/                 the plugin package
  index.js              the Host half: capture, transcription, minutes, Q&A
  client.js             the browser half: library, live view, settings
  live.js               realtime session state
  realtime.js           the capture pipeline
  overlay.js            the floating overlay process
  native/               Swift sources and the built helpers
  tests/                236 tests, run with node --test
```

## Build the native helpers

```sh
cd plugin/native
./build.sh release
```

The script compiles `audio-capture` (microphone + system audio) and
`floating-overlay` (the always-on-top window) into `plugin/native/bin/`.
It needs `swiftc`; the binaries in the repository are built from the sources
next to them.

## Test

```sh
cd plugin
node --expose-gc --test tests/*.test.mjs
```

## License

MIT — see [`LICENSE`](LICENSE). Third-party code is listed in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
