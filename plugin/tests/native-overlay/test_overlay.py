import os
import subprocess
import time
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[2]
NATIVE = PLUGIN / "native"
OVERLAY = NATIVE / "bin" / "floating-overlay"


class FloatingOverlayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run(
            [str(NATIVE / "build.sh")],
            cwd=PLUGIN,
            text=True,
            capture_output=True,
            timeout=120,
        )
        if result.returncode != 0:
            raise AssertionError(result.stdout + result.stderr)
        if not OVERLAY.is_file():
            raise AssertionError("native/bin/floating-overlay was not built")

    def test_self_test_parses_representative_jsonl_without_opening_ui(self):
        result = subprocess.run(
            [str(OVERLAY), "--self-test"],
            cwd=PLUGIN,
            text=True,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("self-test", result.stdout)
        self.assertIn("passed", result.stdout)
        self.assertEqual(result.stderr, "")

    @unittest.skipUnless(
        os.environ.get("RUN_OVERLAY_UI_TEST") == "1",
        "set RUN_OVERLAY_UI_TEST=1 to briefly open the desktop overlay",
    )
    def test_window_launches_and_control_close_exits_cleanly(self):
        initial_events = [
            '{"seq":1,"type":"status","detail":"recording"}',
            '{"seq":2,"type":"transcript","source":"mic","chunkId":1,"text":"Hello"}',
            '{"seq":3,"type":"translation","source":"mic","chunkId":1,"translation":"你好","transcript":"Hello"}',
            '{"seq":4,"type":"error","detail":"example error"}',
        ]
        process = subprocess.Popen(
            [str(OVERLAY)],
            cwd=PLUGIN,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            for event in initial_events:
                process.stdin.write(event + "\n")
            process.stdin.flush()
            time.sleep(1)
            self.assertIsNone(process.poll(), "window exited before the close control")

            process.stdin.write('{"seq":5,"type":"control","detail":"close"}\n')
            process.stdin.flush()
            return_code = process.wait(timeout=10)
            process.stdin.close()
            stdout = process.stdout.read()
            stderr = process.stderr.read()
            self.assertEqual(return_code, 0, stdout + stderr)
            self.assertEqual(stdout, "")
            self.assertEqual(stderr, "")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream and not stream.closed:
                    stream.close()


if __name__ == "__main__":
    unittest.main()
