#!/usr/bin/env python3
"""Persistent offline Fun-ASR-Nano worker using its own Python runtime."""

import argparse
import contextlib
import json
import os
import sys
from pathlib import Path

PROTOCOL_OUT = sys.stdout
REQUIRED_FILES = [
    "config.yaml",
    "configuration.json",
    "multilingual.tiktoken",
    "model.pt",
    "Qwen3-0.6B/config.json",
    "Qwen3-0.6B/generation_config.json",
    "Qwen3-0.6B/merges.txt",
    "Qwen3-0.6B/tokenizer.json",
    "Qwen3-0.6B/tokenizer_config.json",
    "Qwen3-0.6B/vocab.json",
]


class FunAsrEngine:
    def __init__(self, model_dir):
        self.model_dir = Path(model_dir).expanduser().resolve()
        self.model = None
        self.runtime = {}
        self.device = "cpu"
        self.torch = None

    def _validate_snapshot(self):
        missing = [name for name in REQUIRED_FILES if not (self.model_dir / name).is_file()]
        if missing:
            raise RuntimeError(
                "Fun-ASR-Nano 本地模型不完整：%s 缺少 %s"
                % (self.model_dir, ", ".join(missing[:4]))
            )

    def _load_on(self, device):
        # 首选 AutoModel：从本地快照读取 config.yaml，装配
        # SenseVoiceEncoderSmall + Qwen3-0.6B，并准备好 tokenizer/frontend。
        try:
            from funasr import AutoModel

            with contextlib.redirect_stdout(sys.stderr):
                self.model = AutoModel(
                    model=str(self.model_dir),
                    device=device,
                    disable_update=True,
                    log_level="ERROR",
                )
            self.runtime = {}
            self.mode = "automodel"
        except Exception as exc:
            # 兜底：直接使用 FunASRNano 模型类（测试桩与旧版 funasr 走这里）
            print("Fun-ASR AutoModel 不可用，回退模型类接口：%s" % exc, file=sys.stderr)
            from funasr.models.fun_asr_nano.model import FunASRNano

            with contextlib.redirect_stdout(sys.stderr):
                model, runtime = FunASRNano.from_pretrained(
                    model=str(self.model_dir),
                    device=device,
                    disable_update=True,
                )
            self.model = model
            self.runtime = runtime or {}
            self.mode = "class"
        self.device = device

    def _load(self):
        if self.model is not None:
            return
        self._validate_snapshot()
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_DATASETS_OFFLINE"] = "1"
        try:
            import torch
            from funasr.models.fun_asr_nano.model import FunASRNano  # noqa: F401
        except ImportError as exc:
            raise RuntimeError(
                "Fun-ASR 独立运行时缺少依赖，请检查 --fun-asr-python 指向的 venv：%s" % exc
            ) from exc
        self.torch = torch
        use_mps = bool(torch.backends.mps.is_available())
        if use_mps:
            try:
                self._load_on("mps")
                return
            except Exception as exc:
                print("Fun-ASR MPS 加载失败，回落 CPU：%s" % exc, file=sys.stderr)
        self._load_on("cpu")

    def _inference(self, audio_path, hotwords, language, itn):
        if getattr(self, "mode", "automodel") == "class":
            import soundfile as sf

            audio, sample_rate = sf.read(audio_path, dtype="float32")
            if getattr(audio, "ndim", 1) > 1:
                audio = audio.mean(axis=1)
            with contextlib.redirect_stdout(sys.stderr):
                result, _meta = self.model.inference(
                    data_in=[audio],
                    key=["finalize"],
                    tokenizer=self.runtime.get("tokenizer"),
                    frontend=self.runtime.get("frontend"),
                    hotwords=hotwords or [],
                    language=language,
                    itn=bool(itn),
                    device=self.device,
                    sample_rate=sample_rate,
                    bf16=False,
                    fp16=False,
                )
            first = result[0] if isinstance(result, list) and result else (result or {})
            return first if isinstance(first, dict) else {"text": str(first or "")}
        with contextlib.redirect_stdout(sys.stderr):
            result = self.model.generate(
                input=[audio_path],
                cache={},
                batch_size=1,
                hotwords=hotwords or [],
                language=language,
                itn=bool(itn),
            )
        first = result[0] if isinstance(result, list) and result else (result or {})
        if not isinstance(first, dict):
            return {"text": str(first or "")}
        return {
            "text": first.get("text") or "",
            "text_tn": first.get("text_tn") or "",
            "timestamps": first.get("timestamps") or [],
            "ctc_timestamps": first.get("ctc_timestamps") or [],
            "label": first.get("label") or "",
        }

    def transcribe(self, audio_path, hotwords=None, language=None, itn=True):
        self._load()
        hotwords = hotwords or []
        language = language or None
        try:
            return self._inference(audio_path, hotwords, language, itn)
        except Exception as first_error:
            if self.device != "mps":
                raise
            print("Fun-ASR MPS 推理失败，回落 CPU：%s" % first_error, file=sys.stderr)
            self._load_on("cpu")
            return self._inference(audio_path, hotwords, language, itn)


def emit(payload):
    PROTOCOL_OUT.write(json.dumps(payload, ensure_ascii=False) + "\n")
    PROTOCOL_OUT.flush()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fun-asr-dir", required=True)
    args = parser.parse_args()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_DATASETS_OFFLINE"] = "1"
    engine = FunAsrEngine(args.fun_asr_dir)
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            result = engine.transcribe(
                request["audio_path"],
                hotwords=request.get("hotwords") or [],
                language=request.get("language") or None,
                itn=bool(request.get("itn", True)),
            )
            emit({"ok": True, "result": result, "device": engine.device})
        except BaseException as exc:  # 单个请求失败不能让常驻 worker 退出
            emit({"ok": False, "error": str(exc) or exc.__class__.__name__})
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                break


if __name__ == "__main__":
    main()
