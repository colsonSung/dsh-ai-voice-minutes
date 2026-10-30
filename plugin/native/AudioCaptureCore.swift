import AVFoundation
import Foundation

let nativeCaptureSampleRate = 16_000

struct CaptureError: Error, CustomStringConvertible {
    let detail: String

    var description: String { detail }
}

struct CaptureOptions {
    let microphone: Bool
    let system: Bool
    let mixed: Bool

    static func parse(_ object: [String: Any]) throws -> CaptureOptions {
        func boolValue(_ key: String, default defaultValue: Bool) throws -> Bool {
            guard let value = object[key] else { return defaultValue }
            guard let flag = value as? Bool else {
                throw CaptureError(detail: "\(key) must be a boolean")
            }
            return flag
        }

        let microphone = try boolValue("mic", default: true)
        let system = try boolValue("system", default: true)
        let mixed = try boolValue("mixed", default: false)
        guard microphone || system else {
            throw CaptureError(detail: "start requires mic and/or system")
        }
        guard !mixed || (microphone && system) else {
            throw CaptureError(detail: "mixed requires both mic and system")
        }
        return CaptureOptions(microphone: microphone, system: system, mixed: mixed)
    }
}

enum CaptureCommand {
    case start(CaptureOptions)
    case stop

    static func parse(_ line: String) throws -> CaptureCommand {
        guard let data = line.data(using: .utf8) else {
            throw CaptureError(detail: "command is not UTF-8")
        }
        let value: Any
        do {
            value = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw CaptureError(detail: "invalid JSON command: \(error.localizedDescription)")
        }
        guard let object = value as? [String: Any], let command = object["command"] as? String else {
            throw CaptureError(detail: "command must be a JSON object with a command string")
        }
        switch command {
        case "start":
            return .start(try CaptureOptions.parse(object))
        case "stop":
            return .stop
        default:
            throw CaptureError(detail: "unknown command: \(command)")
        }
    }
}

enum AudioSource: String {
    case mic
    case system
    case mix
}

struct AudioChunk: Equatable {
    let source: AudioSource
    /// Monotonic milliseconds, using the same clock for every source.
    let timestamp: Int64
    let samples: [Int16]

    var jsonObject: [String: Any] {
        [
            "type": "audio",
            "source": source.rawValue,
            "timestamp": timestamp,
            "sampleRate": nativeCaptureSampleRate,
            "channels": 1,
            "pcmBase64": pcm16Base64(samples),
        ]
    }
}

func monotonicMilliseconds() -> Int64 {
    Int64(DispatchTime.now().uptimeNanoseconds / 1_000_000)
}

func pcm16Base64(_ samples: [Int16]) -> String {
    var bytes: [UInt8] = []
    bytes.reserveCapacity(samples.count * 2)
    for sample in samples {
        bytes.append(UInt8(truncatingIfNeeded: sample))
        bytes.append(UInt8(truncatingIfNeeded: sample >> 8))
    }
    return Data(bytes).base64EncodedString()
}

func mixPCM16(_ lhs: [Int16], _ rhs: [Int16]) -> [Int16] {
    let count = min(lhs.count, rhs.count)
    var result: [Int16] = []
    result.reserveCapacity(count)
    for index in 0..<count {
        let sum = Int32(lhs[index]) + Int32(rhs[index])
        result.append(Int16(max(Int32(Int16.min), min(Int32(Int16.max), sum))))
    }
    return result
}

final class PCM16Converter {
    private var converter: AVAudioConverter?
    private var inputFormat: AVAudioFormat?

    func convert(_ input: AVAudioPCMBuffer) throws -> [Int16] {
        guard input.frameLength > 0 else { return [] }
        guard let outputFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: Double(nativeCaptureSampleRate),
            channels: 1,
            interleaved: false
        ) else {
            throw CaptureError(detail: "could not create 16 kHz mono conversion format")
        }

        if converter == nil || inputFormat != input.format {
            guard let nextConverter = AVAudioConverter(from: input.format, to: outputFormat) else {
                throw CaptureError(detail: "unsupported input audio format: \(input.format.description)")
            }
            converter = nextConverter
            inputFormat = input.format
        }

        let ratio = Double(nativeCaptureSampleRate) / input.format.sampleRate
        let capacity = max(1, AVAudioFrameCount(ceil(Double(input.frameLength) * ratio)) + 32)
        guard let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else {
            throw CaptureError(detail: "could not allocate converted audio buffer")
        }

        var suppliedInput = false
        var conversionError: NSError?
        let status = converter!.convert(to: output, error: &conversionError) { _, inputStatus in
            if suppliedInput {
                inputStatus.pointee = .noDataNow
                return nil
            }
            suppliedInput = true
            inputStatus.pointee = .haveData
            return input
        }
        if let conversionError {
            throw CaptureError(detail: "audio conversion failed: \(conversionError.localizedDescription)")
        }
        guard status != .error, let channel = output.floatChannelData?[0] else {
            throw CaptureError(detail: "audio conversion did not produce floating-point samples")
        }

        return (0..<Int(output.frameLength)).map { index in
            let sample = channel[index]
            guard sample.isFinite else { return Int16(0) }
            let clipped = max(Float(-1), min(Float(1), sample))
            return Int16(clipped * Float(Int16.max))
        }
    }
}

/// Mixes only overlapping ranges. The independent mic/system events remain authoritative;
/// non-overlapping leading samples are dropped from the optional mix, never from those tracks.
final class OverlapMixer {
    private struct Pending {
        var timestamp: Int64
        var samples: [Int16]

        var end: Int64 {
            timestamp + Int64((samples.count * 1000 + nativeCaptureSampleRate - 1) / nativeCaptureSampleRate)
        }

        mutating func drop(_ count: Int) {
            let actual = min(max(0, count), samples.count)
            timestamp += Int64((actual * 1000) / nativeCaptureSampleRate)
            samples.removeFirst(actual)
        }
    }

    private var microphone: Pending?
    private var system: Pending?

    func ingest(_ chunk: AudioChunk) -> AudioChunk? {
        switch chunk.source {
        case .mic:
            append(chunk, to: &microphone)
        case .system:
            append(chunk, to: &system)
        case .mix:
            return nil
        }

        guard var mic = microphone, var sys = system else { return nil }
        let commonStart = max(mic.timestamp, sys.timestamp)
        let commonEnd = min(mic.end, sys.end)
        guard commonEnd > commonStart else {
            if mic.end <= sys.timestamp { microphone = nil }
            if sys.end <= mic.timestamp { system = nil }
            return nil
        }

        mic.drop(Int((commonStart - mic.timestamp) * Int64(nativeCaptureSampleRate) / 1000))
        sys.drop(Int((commonStart - sys.timestamp) * Int64(nativeCaptureSampleRate) / 1000))
        let count = min(
            Int((commonEnd - commonStart) * Int64(nativeCaptureSampleRate) / 1000),
            mic.samples.count,
            sys.samples.count
        )
        guard count > 0 else {
            microphone = mic.samples.isEmpty ? nil : mic
            system = sys.samples.isEmpty ? nil : sys
            return nil
        }

        let mixed = AudioChunk(
            source: .mix,
            timestamp: commonStart,
            samples: mixPCM16(Array(mic.samples.prefix(count)), Array(sys.samples.prefix(count)))
        )
        mic.drop(count)
        sys.drop(count)
        microphone = mic.samples.isEmpty ? nil : mic
        system = sys.samples.isEmpty ? nil : sys
        return mixed
    }

    private func append(_ chunk: AudioChunk, to pending: inout Pending?) {
        guard !chunk.samples.isEmpty else { return }
        if var existing = pending, existing.end == chunk.timestamp {
            existing.samples.append(contentsOf: chunk.samples)
            pending = existing
        } else {
            pending = Pending(timestamp: chunk.timestamp, samples: chunk.samples)
        }
    }
}

protocol CaptureBackend {
    func start(
        options: CaptureOptions,
        onChunk: @escaping (AudioChunk) -> Void,
        onError: @escaping (Error) -> Void,
        completion: @escaping (Error?) -> Void
    )
    func stop(completion: @escaping () -> Void)
}

final class CaptureSession {
    private enum State {
        case idle
        case starting
        case running
        case stopping
    }

    private let backend: CaptureBackend
    private let emit: ([String: Any]) -> Void
    private let onFinish: (Int32) -> Void
    private let queue = DispatchQueue(label: "local.ai-voice-minutes.capture-session")
    private var state = State.idle
    private var options: CaptureOptions?
    private var mixer = OverlapMixer()
    private var requestedExitCode: Int32 = 0
    private var didFinish = false

    init(
        backend: CaptureBackend,
        emit: @escaping ([String: Any]) -> Void,
        onFinish: @escaping (Int32) -> Void
    ) {
        self.backend = backend
        self.emit = emit
        self.onFinish = onFinish
    }

    func handle(line: String) {
        queue.async {
            do {
                self.handle(try CaptureCommand.parse(line))
            } catch {
                self.emitError(error)
            }
        }
    }

    func stop(exitCode: Int32 = 0) {
        queue.async {
            self.stopOnQueue(exitCode: exitCode)
        }
    }

    private func handle(_ command: CaptureCommand) {
        guard !didFinish else { return }
        switch command {
        case .start(let nextOptions):
            guard state == .idle else {
                emitError(CaptureError(detail: "capture is already starting or running"))
                return
            }
            options = nextOptions
            mixer = OverlapMixer()
            state = .starting
            requestedExitCode = 0
            backend.start(
                options: nextOptions,
                onChunk: { [weak self] chunk in
                    self?.queue.async { self?.receive(chunk) }
                },
                onError: { [weak self] error in
                    self?.queue.async { self?.fail(error) }
                },
                completion: { [weak self] error in
                    self?.queue.async { self?.startCompleted(error) }
                }
            )
        case .stop:
            stopOnQueue(exitCode: 0)
        }
    }

    private func startCompleted(_ error: Error?) {
        guard !didFinish else { return }
        if let error {
            state = .idle
            emitError(error)
            finish(exitCode: 1)
            return
        }
        if state == .stopping {
            stopBackend()
        } else if state == .starting {
            state = .running
        }
    }

    private func receive(_ chunk: AudioChunk) {
        guard !didFinish, state == .starting || state == .running || state == .stopping else { return }
        emit(chunk.jsonObject)
        if options?.mixed == true, let mixed = mixer.ingest(chunk) {
            emit(mixed.jsonObject)
        }
    }

    private func fail(_ error: Error) {
        guard !didFinish else { return }
        emitError(error)
        requestedExitCode = 1
        switch state {
        case .idle:
            finish(exitCode: 1)
        case .starting:
            state = .stopping
        case .running:
            stopBackend()
        case .stopping:
            break
        }
    }

    private func stopOnQueue(exitCode: Int32) {
        guard !didFinish else { return }
        requestedExitCode = exitCode
        switch state {
        case .idle:
            finish(exitCode: exitCode)
        case .starting:
            state = .stopping
        case .running:
            stopBackend()
        case .stopping:
            break
        }
    }

    private func stopBackend() {
        state = .stopping
        backend.stop { [weak self] in
            self?.queue.async { self?.finish(exitCode: self?.requestedExitCode ?? 0) }
        }
    }

    private func emitError(_ error: Error) {
        let detail = (error as? CaptureError)?.detail ?? error.localizedDescription
        emit(["type": "error", "detail": detail])
    }

    private func finish(exitCode: Int32) {
        guard !didFinish else { return }
        didFinish = true
        state = .idle
        emit(["type": "done"])
        onFinish(exitCode)
    }
}
