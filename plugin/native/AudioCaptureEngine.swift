import AVFoundation
import CoreGraphics
import CoreMedia
import Foundation
import ScreenCaptureKit

private let microphoneConsent = "Microphone permission is required. Grant the terminal or hosting application access under System Settings > Privacy & Security > Microphone, then restart that application."
private let systemAudioConsent = "Screen and system audio recording permission is required. Grant the terminal or hosting application access under System Settings > Privacy & Security > Screen & System Audio Recording (Screen Recording on older macOS), then restart that application."

final class DualTrackCapture: CaptureBackend {
    private let queue = DispatchQueue(label: "local.ai-voice-minutes.dual-track-capture")
    private var microphone: MicrophoneCapture?
    private var system: SystemAudioCapture?

    func start(
        options: CaptureOptions,
        onChunk: @escaping (AudioChunk) -> Void,
        onError: @escaping (Error) -> Void,
        completion: @escaping (Error?) -> Void
    ) {
        queue.async {
            self.startMicrophoneThenSystem(
                options: options,
                onChunk: onChunk,
                onError: onError,
                completion: completion
            )
        }
    }

    func stop(completion: @escaping () -> Void) {
        queue.async {
            self.stopSources(completion: completion)
        }
    }

    private func startMicrophoneThenSystem(
        options: CaptureOptions,
        onChunk: @escaping (AudioChunk) -> Void,
        onError: @escaping (Error) -> Void,
        completion: @escaping (Error?) -> Void
    ) {
        func startSystem() {
            guard options.system else {
                completion(nil)
                return
            }
            let capture = SystemAudioCapture()
            self.system = capture
            capture.start(onChunk: onChunk, onError: onError) { error in
                self.queue.async {
                    if let error {
                        self.stopSources { completion(error) }
                    } else {
                        completion(nil)
                    }
                }
            }
        }

        guard options.microphone else {
            startSystem()
            return
        }
        let capture = MicrophoneCapture()
        self.microphone = capture
        capture.start(onChunk: onChunk, onError: onError) { error in
            self.queue.async {
                if let error {
                    self.stopSources { completion(error) }
                } else {
                    startSystem()
                }
            }
        }
    }

    private func stopSources(completion: @escaping () -> Void) {
        let microphone = self.microphone
        let system = self.system
        self.microphone = nil
        self.system = nil
        let group = DispatchGroup()
        if let microphone {
            group.enter()
            microphone.stop { group.leave() }
        }
        if let system {
            group.enter()
            system.stop { group.leave() }
        }
        group.notify(queue: queue, execute: completion)
    }
}

private final class MicrophoneCapture {
    private let engine = AVAudioEngine()
    private let converter = PCM16Converter()
    private let lock = NSLock()
    private var active = false

    func start(
        onChunk: @escaping (AudioChunk) -> Void,
        onError: @escaping (Error) -> Void,
        completion: @escaping (Error?) -> Void
    ) {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            startEngine(onChunk: onChunk, onError: onError, completion: completion)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                if granted {
                    self.startEngine(onChunk: onChunk, onError: onError, completion: completion)
                } else {
                    completion(CaptureError(detail: microphoneConsent))
                }
            }
        case .denied, .restricted:
            completion(CaptureError(detail: microphoneConsent))
        @unknown default:
            completion(CaptureError(detail: microphoneConsent))
        }
    }

    func stop(completion: () -> Void) {
        lock.lock()
        active = false
        lock.unlock()
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        completion()
    }

    private func startEngine(
        onChunk: @escaping (AudioChunk) -> Void,
        onError: @escaping (Error) -> Void,
        completion: @escaping (Error?) -> Void
    ) {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate.isFinite, format.sampleRate > 0, format.channelCount > 0 else {
            completion(CaptureError(detail: "No active microphone input is available."))
            return
        }
        lock.lock()
        active = true
        lock.unlock()
        input.installTap(onBus: 0, bufferSize: 1600, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            self.lock.lock()
            let shouldProcess = self.active
            self.lock.unlock()
            guard shouldProcess else { return }
            do {
                let samples = try self.converter.convert(buffer)
                if !samples.isEmpty {
                    onChunk(AudioChunk(source: .mic, timestamp: monotonicMilliseconds(), samples: samples))
                }
            } catch {
                onError(error)
            }
        }
        do {
            engine.prepare()
            try engine.start()
            completion(nil)
        } catch {
            input.removeTap(onBus: 0)
            lock.lock()
            active = false
            lock.unlock()
            completion(CaptureError(detail: "Microphone capture failed: \(error.localizedDescription)"))
        }
    }
}

private final class SystemAudioCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    private let queue = DispatchQueue(label: "local.ai-voice-minutes.system-audio")
    private let converter = PCM16Converter()
    private var stream: SCStream?
    private var active = false
    private var onChunk: ((AudioChunk) -> Void)?
    private var onError: ((Error) -> Void)?

    func start(
        onChunk: @escaping (AudioChunk) -> Void,
        onError: @escaping (Error) -> Void,
        completion: @escaping (Error?) -> Void
    ) {
        self.onChunk = onChunk
        self.onError = onError
        guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else {
            completion(CaptureError(detail: systemAudioConsent))
            return
        }

        Task {
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
                self.startStream(content: content, completion: completion)
            } catch {
                completion(CaptureError(detail: "Could not inspect shareable displays: \(error.localizedDescription). \(systemAudioConsent)"))
            }
        }
    }

    private func startStream(content: SCShareableContent, completion: @escaping (Error?) -> Void) {
        guard let display = content.displays.first else {
            completion(CaptureError(detail: "No display is available for ScreenCaptureKit system audio capture."))
            return
        }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.capturesAudio = true
        configuration.excludesCurrentProcessAudio = true
        configuration.sampleRate = 48_000
        configuration.channelCount = 2
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 60)
        configuration.showsCursor = false
        configuration.queueDepth = 6

        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        do {
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: self.queue)
        } catch {
            completion(CaptureError(detail: "Could not attach ScreenCaptureKit audio output: \(error.localizedDescription)"))
            return
        }
        self.stream = stream
        stream.startCapture { error in
            if let error {
                completion(CaptureError(detail: "ScreenCaptureKit system audio failed to start: \(error.localizedDescription). \(systemAudioConsent)"))
            } else {
                self.active = true
                completion(nil)
            }
        }
    }

    func stop(completion: @escaping () -> Void) {
        active = false
        onChunk = nil
        onError = nil
        guard let stream else {
            completion()
            return
        }
        self.stream = nil
        stream.stopCapture { _ in completion() }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, active, let onChunk else { return }
        do {
            let samples = try withPCMBuffer(from: sampleBuffer) { buffer in
                try converter.convert(buffer)
            }
            if !samples.isEmpty {
                onChunk(AudioChunk(source: .system, timestamp: monotonicMilliseconds(), samples: samples))
            }
        } catch {
            onError?(error)
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        onError?(CaptureError(detail: "ScreenCaptureKit stopped: \(error.localizedDescription)"))
    }
}

private func withPCMBuffer<T>(
    from sampleBuffer: CMSampleBuffer,
    body: (AVAudioPCMBuffer) throws -> T
) throws -> T {
    guard let description = CMSampleBufferGetFormatDescription(sampleBuffer) else {
        throw CaptureError(detail: "System audio sample has no format description")
    }
    let format = AVAudioFormat(cmAudioFormatDescription: description)

    var requiredSize = 0
    var status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
        sampleBuffer,
        bufferListSizeNeededOut: &requiredSize,
        bufferListOut: nil,
        bufferListSize: 0,
        blockBufferAllocator: kCFAllocatorDefault,
        blockBufferMemoryAllocator: kCFAllocatorDefault,
        flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment),
        blockBufferOut: nil
    )
    guard status == noErr else {
        throw CaptureError(detail: "Could not measure system audio buffer (OSStatus \(status))")
    }

    let rawList = UnsafeMutableRawPointer.allocate(byteCount: requiredSize, alignment: 16)
    defer { rawList.deallocate() }
    let bufferList = rawList.bindMemory(to: AudioBufferList.self, capacity: 1)
    var blockBuffer: CMBlockBuffer?
    status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
        sampleBuffer,
        bufferListSizeNeededOut: &requiredSize,
        bufferListOut: bufferList,
        bufferListSize: requiredSize,
        blockBufferAllocator: kCFAllocatorDefault,
        blockBufferMemoryAllocator: kCFAllocatorDefault,
        flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment),
        blockBufferOut: &blockBuffer
    )
    guard status == noErr else {
        throw CaptureError(detail: "Could not read system audio buffer (OSStatus \(status))")
    }
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: bufferList, deallocator: nil) else {
        throw CaptureError(detail: "Could not create AVAudioPCMBuffer for system audio")
    }
    buffer.frameLength = AVAudioFrameCount(CMSampleBufferGetNumSamples(sampleBuffer))
    return try body(buffer)
}
