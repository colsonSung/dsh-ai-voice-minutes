# Third-party notices

AI Voice Minutes' own code is licensed under MIT. It also builds on these
packages:

- **React and ReactDOM** — MIT License, Meta Platforms. Both are marked
  external and come from the Harness shell's own module table; no copy is
  bundled into the plugin.
- **esbuild** — MIT License. Used by the development tooling to build and
  bundle the client.
- **vitest-style test helpers** — MIT License.

The native helpers are compiled from the Swift sources in `plugin/native/`
with the Xcode toolchain and link only against system frameworks
(AVFoundation, ScreenCaptureKit, SwiftUI, AppKit) and the C++ standard
library that ships with Xcode.

The speech-to-text engines the plugin can drive are downloaded separately by
the user and are not part of this repository:

- **whisper.cpp** — MIT License, Georgi Gerganov.
- **FunASR / SenseVoice** — Apache License 2.0, Alibaba DAMO Academy.
- **Hy-MT2** — the translation model, loaded from a local GGUF the user
  provides.

Consult the upstream projects' own license files for the complete terms.
