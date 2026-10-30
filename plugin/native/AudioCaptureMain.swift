import Darwin
import Foundation

final class JSONLWriter {
    private let lock = NSLock()
    private let output = FileHandle.standardOutput

    func write(_ object: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        else { return }
        lock.lock()
        defer { lock.unlock() }
        output.write(data)
        output.write(Data([0x0A]))
    }
}

@main
struct AudioCaptureMain {
    static func main() {
        let writer = JSONLWriter()
        #if CAPTURE_TESTING
        let backend = FakeCaptureBackend()
        #else
        let backend = DualTrackCapture()
        #endif
        let session = CaptureSession(
            backend: backend,
            emit: { writer.write($0) },
            onFinish: { code in exit(code) }
        )

        for number in [SIGINT, SIGTERM] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { session.stop(exitCode: 0) }
            source.resume()
            signalSources.append(source)
        }

        DispatchQueue.global(qos: .userInitiated).async {
            while let line = readLine(strippingNewline: true) {
                session.handle(line: line)
            }
            session.stop(exitCode: 0)
        }
        RunLoop.main.run()
    }
}

private var signalSources: [DispatchSourceSignal] = []
