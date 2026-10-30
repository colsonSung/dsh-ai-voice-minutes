import Foundation

final class FakeCaptureBackend: CaptureBackend {
    func start(
        options: CaptureOptions,
        onChunk: @escaping (AudioChunk) -> Void,
        onError: @escaping (Error) -> Void,
        completion: @escaping (Error?) -> Void
    ) {
        if options.microphone {
            onChunk(AudioChunk(source: .mic, timestamp: 10, samples: [1000, -1000, 32767]))
        }
        if options.system {
            onChunk(AudioChunk(source: .system, timestamp: 10, samples: [500, 500, 1]))
        }
        completion(nil)
    }

    func stop(completion: @escaping () -> Void) {
        completion()
    }
}
