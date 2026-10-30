# Security policy

## The short version

Your recordings stay on your machine. The plugin captures audio with a native
helper, writes it to `~/.ai-minutes/`, transcribes it against the local
service you configure, and never uploads the audio itself.

It does make **outbound calls**, and only the ones you configure:

| Call | When | What leaves your machine |
| --- | --- | --- |
| your local ASR server | you import or record an audio file | the audio, to `http://127.0.0.1:8010` |
| your translation endpoint | a caption is translated | the sentence that was spoken |
| your minutes endpoint | you generate minutes or ask a question | the transcript, or the history of your meetings |
| a cloud model, when configured | the same moments | the same text, to the endpoint you chose |

There is no telemetry, no analytics and no crash reporting.

## Where your data lives

| What | Where it lives | How to remove it |
| --- | --- | --- |
| recordings and tracks | `~/.ai-minutes/audio/`, `~/.ai-minutes/realtime/` | delete the file, or use the trash button in the meeting page |
| transcripts and minutes | `~/.ai-minutes/meetings/<id>.json` | delete the meeting in the library |
| settings | `~/.ai-minutes/settings.json` | delete the file; the defaults come back |
| the floating overlay's frame | `~/.ai-minutes/overlay-window.json` | delete the file |
| API keys | the macOS keychain, service names `ai-minutes-api-key`, `siliconflow-api-key`, `translation-api-key` | `security delete-generic-password -s <service>` |

No API key is stored in the plugin, in the settings file, or in the browser
bundle. The Host half reads the keychain; the browser half never sees it.

## What the plugin can reach

- **The filesystem under `~/.ai-minutes/`.** It owns that directory: the
  recordings, the transcripts, the minutes and the settings. It reads and
  writes it and nothing else in your home directory.
- **The Host route `/api/ai-minutes`.** The browser half posts to this route,
  registered through the Connection service's Fetch registry. The caller is
  authenticated with the same browser session the rest of the application
  uses. The route accepts a fixed set of methods (`health`, `settings`,
  `transcribe`, `summarize`, `ask`, `ask-history`, `translate`, `list`, `get`,
  `save`, `delete`, `live-*`, `audio-*`) and rejects anything else.
- **The microphone and the screen.** The capture helper asks for the macOS
  microphone permission and the screen-recording permission, and it needs
  both to record system audio. The plugin never starts capturing on its own.
- **Your workspace?** No. The plugin reads no workspace file.

## What it does not do

- **No telemetry, no analytics, no crash reporting.**
- **No reading of `~/.dsh/credentials.yaml` or any other credential store.**
  The only credentials it looks for are its own, in the keychain entries
  listed above.
- **No background processes beyond the one you start.** The capture helper
  and the floating overlay live only as long as the meeting does.
- **No uploading of your recordings.** The audio goes to your local ASR
  server, and only to your local ASR server, unless you point the ASR
  setting at a cloud endpoint.

## Native helpers

`plugin/native/audio-capture` and `plugin/native/floating-overlay` are
compiled from the Swift sources in `plugin/native/`. They link only against
the system frameworks (AVFoundation, ScreenCaptureKit, SwiftUI, AppKit) and
the C++ standard library that ships with the Xcode toolchain.

## Reporting a problem

Please report security issues privately through GitHub's
[security advisory](https://docs.github.com/en/code-security/security-advisories)
form for this repository rather than opening a public issue.
