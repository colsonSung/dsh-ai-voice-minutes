# Native audio capture and floating transcript overlay

`audio-capture` is a Swift command-line helper for local meeting audio. It uses **AVAudioEngine** for microphone input and **ScreenCaptureKit** for system output audio. It never changes the selected input/output device, adds an aggregate device, or otherwise changes audio routing.

## Build

Requirements: macOS 13 or later and Xcode with `swiftc` available through `xcrun`.

```sh
native/build.sh
```

Outputs:

- `native/bin/audio-capture`
- `native/bin/floating-overlay`

Build the fake-backend protocol binary and Swift core test binary with:

```sh
native/build.sh --test
python3 -m unittest discover -s tests/native-audio -v
```

The fake backend is compiled only into `native/build/audio-capture-test`; it is not present in the release helper.

## `audio-capture` JSONL process protocol

Write one JSON command per stdin line. stdout contains JSONL events only; diagnostics, if any, use stderr.

Start both independent tracks (the default):

```json
{"command":"start","mic":true,"system":true,"mixed":false}
```

Set `mixed` to `true` to add the optional `mix` track. The mix requires both sources. It mixes timestamp-overlapping ranges with Int16 saturation; the independent `mic` and `system` tracks are authoritative and are never altered by mixing.

Stop with:

```json
{"command":"stop"}
```

Each audio event has exactly this shape:

```json
{"type":"audio","source":"mic","timestamp":123456789,"sampleRate":16000,"channels":1,"pcmBase64":"AAABAP//AAE="}
```

- `source` is `mic`, `system`, or `mix`.
- `timestamp` is integer **monotonic milliseconds** from one shared clock, suitable for comparing tracks within a run. It is not wall-clock time.
- `pcmBase64` decodes to signed little-endian PCM16 mono samples at 16 kHz.

Errors and completion have exactly these shapes:

```json
{"type":"error","detail":"human-readable detail"}
{"type":"done"}
```

There is no `started` event. Invalid JSON/commands produce a nonfatal `error`. A requested capture that cannot start, or a fatal runtime capture failure, produces `error`, then `done`, and exits 1.

## Exit and signal behavior

- `stop`: flush the final `done` event and exit 0.
- stdin EOF: stop any active capture, emit `done`, and exit 0.
- SIGINT or SIGTERM: gracefully stop, emit `done`, and exit 0.
- Fatal start/runtime error: emit `error` and `done`, then exit 1.
- SIGKILL cannot run cleanup or emit `done`.

## `floating-overlay` desktop transcript window

`floating-overlay` is an accessory-app SwiftUI view hosted in an AppKit window. Its dark window floats above normal windows, is available across Spaces, and can be dragged by its title/background or resized from its window edges. It shows the 100 most recent rows in two columns, **Original** and **Translation**, with the latest status and error below the transcript.

Run it as a JSONL consumer. Normal window mode writes no stdout events:

```sh
native/bin/floating-overlay <<'JSONL'
{"seq":1,"type":"status","detail":"recording"}
{"seq":2,"type":"transcript","source":"mic","chunkId":1,"text":"Hello"}
{"seq":3,"type":"translation","source":"mic","chunkId":1,"translation":"你好","transcript":"Hello"}
{"seq":4,"type":"control","detail":"close"}
JSONL
```

Accepted event shapes:

- `transcript`: `text` is shown in **Original**.
- `translation`: `translation` is shown in **Translation**, falling back to `text`; optional `transcript` supplies the original text.
- `status` and `error`: `detail` updates the corresponding footer display.
- `control`: `detail: "close"` closes the window and exits 0.

Transcript and translation events pair into one row when their `source` and `chunkId` match. `seq` is a fallback row identity; a translation can also match the latest untranslated row with identical original text. Unknown event types and other control details are ignored. Malformed JSONL does not terminate the process; it is reported in the error footer.

Closing the window, stdin EOF, SIGINT, or SIGTERM also exits cleanly. EOF handling prevents an orphaned floating window when its producer exits.

### Overlay verification

The self-test parses representative transcript, translation, status, error, close, unknown, and malformed events without creating an `NSApplication` or opening a window:

```sh
native/bin/floating-overlay --self-test
python3 -m unittest discover -s tests/native-overlay -v
```

To briefly open the real desktop window and verify that a close control exits the process, opt in explicitly:

```sh
RUN_OVERLAY_UI_TEST=1 python3 -m unittest discover -s tests/native-overlay -v
```

## macOS consent

The privacy prompt is attributed to the **responsible terminal or hosting application** (for example Terminal or DeepSeek Harness), not necessarily to `audio-capture` itself. Grant consent to that process and restart it after changing either setting.

- Microphone: **System Settings > Privacy & Security > Microphone**.
- System audio through ScreenCaptureKit: **System Settings > Privacy & Security > Screen & System Audio Recording** (named **Screen Recording** on older macOS versions).

`native/Info.plist` supplies the microphone usage string in the release executable. ScreenCaptureKit consent is checked/requested only when the `system` track is requested; microphone consent is checked/requested only when `mic` is requested.
