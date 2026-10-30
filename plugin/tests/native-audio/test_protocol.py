import base64
import json
import struct
import subprocess
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[2]
NATIVE = PLUGIN / "native"
RELEASE = NATIVE / "bin" / "audio-capture"
TEST_BINARY = NATIVE / "build" / "audio-capture-test"
CORE_TESTS = NATIVE / "build" / "audio-capture-core-tests"


def decode_pcm(event):
    raw = base64.b64decode(event["pcmBase64"], validate=True)
    assert len(raw) % 2 == 0
    return list(struct.unpack("<%dh" % (len(raw) // 2), raw))


class NativeAudioTests(unittest.TestCase):
    def build(self, test=False):
        script = NATIVE / "build.sh"
        self.assertTrue(script.is_file(), "native/build.sh is missing")
        command = [str(script)] + (["--test"] if test else [])
        result = subprocess.run(command, cwd=PLUGIN, text=True, capture_output=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def run_jsonl(self, binary, lines, timeout=15):
        result = subprocess.run(
            [str(binary)],
            input="\n".join(lines) + "\n",
            cwd=PLUGIN,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
        events = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
        return result, events

    def test_release_build_and_idle_stop(self):
        self.build()
        self.assertTrue(RELEASE.is_file())
        result, events = self.run_jsonl(RELEASE, ['{"command":"stop"}'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(events, [{"type": "done"}])

    def test_swift_core_tests(self):
        self.build(test=True)
        result = subprocess.run([str(CORE_TESTS)], cwd=PLUGIN, text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("all native core tests passed", result.stdout)

    def test_start_stop_emits_separate_pcm_tracks_and_optional_mix(self):
        self.build(test=True)
        result, events = self.run_jsonl(TEST_BINARY, [
            '{"command":"start","mic":true,"system":true,"mixed":true}',
            '{"command":"stop"}',
        ])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(events[-1], {"type": "done"})
        audio = [event for event in events if event.get("type") == "audio"]
        self.assertEqual({event["source"] for event in audio}, {"mic", "system", "mix"})
        for event in audio:
            self.assertEqual(
                set(event),
                {"type", "source", "timestamp", "sampleRate", "channels", "pcmBase64"},
            )
            self.assertEqual(event["sampleRate"], 16000)
            self.assertEqual(event["channels"], 1)
            self.assertIsInstance(event["timestamp"], int)
        by_source = {event["source"]: event for event in audio}
        self.assertEqual(decode_pcm(by_source["mic"]), [1000, -1000, 32767])
        self.assertEqual(decode_pcm(by_source["system"]), [500, 500, 1])
        self.assertEqual(decode_pcm(by_source["mix"]), [1500, -500, 32767])

    def test_invalid_json_and_invalid_start_emit_errors_then_stop_done(self):
        self.build(test=True)
        result, events = self.run_jsonl(TEST_BINARY, [
            "not-json",
            '{"command":"start","mic":false,"system":false}',
            '{"command":"stop"}',
        ])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(events[-1], {"type": "done"})
        errors = [event for event in events if event.get("type") == "error"]
        self.assertEqual(len(errors), 2)
        for event in errors:
            self.assertEqual(set(event), {"type", "detail"})
            self.assertTrue(event["detail"])

    def test_stdin_eof_gracefully_stops(self):
        self.build(test=True)
        result, events = self.run_jsonl(TEST_BINARY, [
            '{"command":"start","mic":true,"system":false,"mixed":false}',
        ])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(events[-1], {"type": "done"})


if __name__ == "__main__":
    unittest.main()
