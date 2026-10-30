import AVFoundation
import Foundation

private var failures: [String] = []

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        failures.append(message)
        FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
    }
}

private func testCommandParsing() {
    do {
        switch try CaptureCommand.parse("{\"command\":\"start\",\"mic\":true,\"system\":false}") {
        case .start(let options):
            expect(options.microphone, "start should enable microphone")
            expect(!options.system, "start should disable system audio")
            expect(!options.mixed, "mixed should default to false")
        default:
            expect(false, "start command did not parse as start")
        }
        switch try CaptureCommand.parse("{\"command\":\"stop\"}") {
        case .stop: break
        default: expect(false, "stop command did not parse as stop")
        }
    } catch {
        expect(false, "valid commands threw: \(error)")
    }

    for invalid in [
        "not-json",
        "{\"command\":\"start\",\"mic\":false,\"system\":false}",
        "{\"command\":\"start\",\"mic\":true,\"system\":false,\"mixed\":true}",
        "{\"command\":\"unknown\"}",
    ] {
        do {
            _ = try CaptureCommand.parse(invalid)
            expect(false, "invalid command was accepted: \(invalid)")
        } catch {}
    }
}

private func testPCMEncoding() {
    expect(pcm16Base64([0, 1, -1, 256]) == "AAABAP//AAE=", "PCM16 must be little-endian base64")
    let mixed = mixPCM16([1000, -1000, 32767, -32768], [500, 500, 1, -1])
    expect(mixed == [1500, -500, 32767, -32768], "mixing must add and clamp Int16 samples: \(mixed)")
}

private func testPCMConversion() {
    let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 6)!
    buffer.frameLength = 6
    let values: [Float] = [0, 0.5, -0.5, 1, -1, 2]
    for index in values.indices {
        buffer.floatChannelData![0][index] = values[index]
    }
    do {
        let samples = try PCM16Converter().convert(buffer)
        expect(samples == [0, 16383, -16383, 32767, -32767, 32767], "float conversion/clamping mismatch: \(samples)")
    } catch {
        expect(false, "PCM conversion threw: \(error)")
    }

    let stereo = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 2, interleaved: false)!
    let resampleInput = AVAudioPCMBuffer(pcmFormat: stereo, frameCapacity: 480)!
    resampleInput.frameLength = 480
    for index in 0..<480 {
        let sample = sin(Float(index) * 2 * .pi * 440 / 48000) * 0.5
        resampleInput.floatChannelData![0][index] = sample
        resampleInput.floatChannelData![1][index] = sample
    }
    do {
        let samples = try PCM16Converter().convert(resampleInput)
        // AVAudioConverter retains a few frames of initial resampling latency.
        expect((150...162).contains(samples.count), "48 kHz to 16 kHz conversion emitted \(samples.count) frames")
        expect(samples.contains(where: { $0 != 0 }), "resampled audio is unexpectedly silent")
    } catch {
        expect(false, "stereo resampling threw: \(error)")
    }
}

private func testOverlapMixing() {
    let mixer = OverlapMixer()
    expect(mixer.ingest(AudioChunk(source: .mic, timestamp: 1000, samples: Array(repeating: 100, count: 48))) == nil,
           "mix must wait for the second source")
    let first = mixer.ingest(AudioChunk(source: .system, timestamp: 1001, samples: Array(repeating: 50, count: 16)))
    expect(first?.source == .mix, "mixed source must be mix")
    expect(first?.timestamp == 1001, "mixed timestamp must align to overlap")
    expect(first?.samples == Array(repeating: 150, count: 16), "mixed overlap must use timestamp-aligned samples")
    let second = mixer.ingest(AudioChunk(source: .system, timestamp: 1002, samples: Array(repeating: 25, count: 16)))
    expect(second?.timestamp == 1002, "buffered microphone sample should mix at its timestamp")
    expect(second?.samples == Array(repeating: 125, count: 16), "buffered microphone sample was not retained")
}

private func testAudioEventShape() {
    let chunk = AudioChunk(source: .mic, timestamp: 42, samples: [0, 1, -1, 256])
    let object = chunk.jsonObject
    expect(Set(object.keys) == ["type", "source", "timestamp", "sampleRate", "channels", "pcmBase64"],
           "audio JSON keys drifted: \(object.keys)")
    expect(object["type"] as? String == "audio", "audio event type mismatch")
    expect(object["source"] as? String == "mic", "microphone source must be mic")
    expect(object["timestamp"] as? Int64 == 42, "timestamp mismatch")
    expect(object["sampleRate"] as? Int == 16000, "sample rate must be 16 kHz")
    expect(object["channels"] as? Int == 1, "audio must be mono")
    expect(object["pcmBase64"] as? String == "AAABAP//AAE=", "audio payload mismatch")
}

@main
struct AudioCaptureCoreTests {
    static func main() {
        testCommandParsing()
        testPCMEncoding()
        testPCMConversion()
        testOverlapMixing()
        testAudioEventShape()
        if failures.isEmpty {
            print("all native core tests passed")
        } else {
            FileHandle.standardError.write(Data("\(failures.count) native core test(s) failed\n".utf8))
            exit(1)
        }
    }
}
