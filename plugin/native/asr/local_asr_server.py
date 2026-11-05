#!/usr/bin/env python3
"""本地 ASR 服务（OpenAI 兼容），给评审壳的转写用。

默认用 faster-whisper：依赖与模型都已在本机缓存，可完全离线运行。
提供：
    GET  /health                      健康检查
    GET  /v1/models                   可用模型清单
    POST /v1/audio/transcriptions     OpenAI 兼容转写（multipart）
    POST /audio/transcriptions        同上（不带 /v1 前缀也能用）

启动：
    python3 .claude/skills/prototype-design/scripts/local_asr_server.py \
        --port 8010 --model base --device auto

参数说明：
    --model     faster-whisper 模型名，默认 base（本机已缓存 small/base 之外需联网下载）
    --language  语言提示，例如 zh；留空表示自动检测
    --device    auto / cpu / cuda / mps
    --compute   int8 / int8_float16 / float16 / float32
"""

import argparse
import os
import re
import time
from pathlib import Path

try:
    from fastapi import FastAPI, File, Form, UploadFile, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    import uvicorn
except ImportError as exc:  # pragma: no cover
    raise SystemExit("缺少依赖，请先安装：pip install fastapi uvicorn python-multipart faster-whisper") from exc

STATE = {
    "model_name": "base",
    "model": None,
    "device": "auto",
    "compute_type": "int8",
    "language": "",
    "loaded_at": None,
    "load_seconds": 0.0,
    "diarize": False,
    "diarize_threshold": 0.68,
    "diarize_speakers": 3,
    "diarize_model": "speechbrain/spkrec-ecapa-voxceleb",
    "voiceprints": {},
    "embedder": None,
    "embedder_device": "cpu",
    "beam": 5,
    "backend": "whispercpp",
    "whisper_cpp_bin": "",
    "whisper_cpp_model": "",
    "max_len": 25,
    "threads": 8,
    "use_gpu": True,
    "timeout": 1800,
    "prompt": "",
    "sense_voice_dir": "",
    "moss_model_dir": "",
    "fun_asr_dir": "",
    "fun_asr_python": "",
    "use_mps": True,
}

app = FastAPI(title="Onerway Local ASR", version="1.0")
# 评审壳在浏览器里直接探测与调用本机服务，需要放开跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_model():
    if STATE["model"] is None:
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise HTTPException(status_code=500, detail="缺少 faster-whisper：pip install faster-whisper")
        started = time.time()
        try:
            STATE["model"] = WhisperModel(
                STATE["model_name"],
                device=STATE["device"],
                compute_type=STATE["compute_type"],
                local_files_only=True,
            )
        except Exception:
            # 模型没缓存时允许联网下载
            STATE["model"] = WhisperModel(
                STATE["model_name"],
                device=STATE["device"],
                compute_type=STATE["compute_type"],
            )
        STATE["load_seconds"] = time.time() - started
        STATE["loaded_at"] = time.time()
    return STATE["model"]


def find_whisper_cpp_model(explicit=""):
    if explicit:
        path = Path(explicit)
        return path if path.is_file() else None
    root = Path(__file__).resolve().parent / "models"
    if not root.is_dir():
        return None
    preferred = [
        "ggml-large-v3.bin",            # f16：精度最高，Metal 14 倍实时
        "ggml-large-v3-q5_0.bin",       # 量化版：速度几乎相同
        "ggml-large-v3-turbo-q5_0.bin",  # 最快，质量略低
    ]
    for name in preferred:
        candidate = root / name
        if candidate.is_file():
            return candidate
    models = sorted(root.glob("ggml-*.bin"))
    return models[0] if models else None


def transcribe_whisper_cpp(audio_path, language="zh", prompt=""):
    """用 whisper.cpp（Apple Silicon 走 Metal GPU）转写，返回带时间戳的分段。"""
    import json as _json
    import shutil
    import subprocess as _subprocess

    binary = STATE["whisper_cpp_bin"] or shutil.which("whisper-cli")
    if not binary or not Path(binary).exists():
        raise HTTPException(status_code=500, detail="未找到 whisper-cli，请先 brew install whisper-cpp")
    model = find_whisper_cpp_model(STATE["whisper_cpp_model"])
    if not model is None and not model:
        raise HTTPException(status_code=500, detail="未找到 ggml 模型，请放到插件 native/asr/models/ 目录")
    if model is None:
        raise HTTPException(status_code=500, detail="未配置 ggml 模型路径")
    prefix = os.path.join("/tmp", "onerway-wcpp-%d" % int(time.time() * 1000))
    cmd = [
        binary, "-m", str(model), "-f", audio_path, "-l", language or "zh",
        "-oj", "-of", prefix, "-ml", str(STATE["max_len"]), "-sow", "-np",
        "-t", str(STATE["threads"]), "-ng" if not STATE["use_gpu"] else "",
    ]
    if prompt:
        # 领域术语偏置：把 KYC/KYB 这类词写进 prompt，模型更不容易同音错识
        cmd += ["--prompt", prompt]
    cmd = [part for part in cmd if part]
    try:
        _subprocess.run(cmd, capture_output=True, check=False, timeout=STATE["timeout"])
    except _subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="whisper.cpp 转写超时")
    data_path = prefix + ".json"
    if not os.path.isfile(data_path):
        raise HTTPException(status_code=500, detail="whisper.cpp 未产出结果，请查看服务日志")
    with open(data_path, encoding="utf-8") as handle:
        data = _json.load(handle)
    rows = []
    for item in data.get("transcription", []):
        offsets = item.get("offsets") or {}
        text = (item.get("text") or "").strip()
        if not text:
            continue
        rows.append({
            "id": len(rows),
            "start": round(float(offsets.get("from", 0)) / 1000.0, 3),
            "end": round(float(offsets.get("to", 0)) / 1000.0, 3),
            "text": text,
            "speaker": "",
        })
    try:
        os.remove(data_path)
    except OSError:
        pass
    return rows


_MOSS = {"model": None, "processor": None}


def get_moss():
    """MOSS-Transcribe-Diarize（0.9B）：一次推理出转写+说话人+时间戳。"""
    if _MOSS["model"] is None:
        import torch
        from transformers import AutoModelForCausalLM, AutoProcessor
        directory = STATE["moss_model_dir"]
        if not directory or not Path(directory).is_dir():
            raise HTTPException(status_code=500, detail="未配置 MOSS 模型目录（--moss-model-dir）")
        device = "mps" if STATE["use_mps"] and torch.backends.mps.is_available() else "cpu"
        dtype = torch.bfloat16 if device == "cuda" else torch.float32
        _MOSS["model"] = AutoModelForCausalLM.from_pretrained(
            directory, trust_remote_code=True, dtype="auto", attn_implementation="sdpa",
        ).to(dtype=dtype).to(device).eval()
        _MOSS["processor"] = AutoProcessor.from_pretrained(directory, trust_remote_code=True)
        _MOSS["device"] = device
    return _MOSS["model"], _MOSS["processor"]


def transcribe_moss(audio_path, language="zh", prompt=""):
    """用 MOSS-Transcribe-Diarize 转写：原生说话人 + 时间戳，单次可处理 90 分钟。"""
    from moss_transcribe_diarize import parse_transcript
    from moss_transcribe_diarize.inference_utils import build_transcription_messages, generate_transcription
    import torch

    model, processor = get_moss()
    device = torch.device(_MOSS.get("device", "cpu"))
    dtype = torch.bfloat16 if device.type == "cuda" else torch.float32
    instruction = (
        "请将音频转写为文本，每一段需以起始时间戳和说话人编号（[S01]、[S02]、[S03]…）开头，"
        "正文为对应的语音内容，并在段末标注结束时间戳，以清晰标明该段语音范围。"
    )
    if prompt:
        instruction += "热词提示：" + prompt
    messages = build_transcription_messages(audio_path, instruction)
    result = generate_transcription(
        model, processor, messages, max_new_tokens=8192, do_sample=False,
        device=device, dtype=dtype,
    )
    rows = []
    for segment in parse_transcript(result["text"]):
        text = (segment.text or "").strip()
        if not text:
            continue
        speaker = (segment.speaker or "").strip().strip("[]")
        rows.append({
            "id": len(rows),
            "start": round(float(segment.start), 3),
            "end": round(float(segment.end), 3),
            "text": text,
            "speaker": speaker,
        })
    return rows


def sense_voice_recognizer():
    import sherpa_onnx

    root = STATE["sense_voice_dir"]
    model = Path(root) / "model.int8.onnx" if root else None
    tokens = Path(root) / "tokens.txt" if root else None
    if not model or not model.is_file() or not tokens or not tokens.is_file():
        raise HTTPException(status_code=500, detail="未找到 SenseVoice 模型（--sense-voice-dir）")
    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(model), tokens=str(tokens), num_threads=STATE["threads"],
        provider="cpu", use_itn=True,
    )


def sense_voice_text(recognizer, audio, sample_rate):
    stream = recognizer.create_stream()
    stream.accept_waveform(sample_rate, audio)
    recognizer.decode_stream(stream)
    return (stream.result.text or "").strip()


def merge_spans(spans, gap=1.2, min_len=2.0):
    """把相邻的同一说话人区间合并，避免逐小段转写把句子切碎。

    短区间只有在和前一段属于同一个说话人时才并进去：
    跨说话人合并会把另一个人的声音并掉，听起来像全程只有一个人说话。
    """
    merged = []
    for span in spans:
        if merged and merged[-1]["speaker"] == span["speaker"] and span["start"] - merged[-1]["end"] <= gap:
            merged[-1]["end"] = max(merged[-1]["end"], span["end"])
            continue
        merged.append(dict(span))
    # 合并后仍太短的，只并进同说话人的前一段
    out = []
    for span in merged:
        if out and out[-1]["speaker"] == span["speaker"] and (span["end"] - span["start"]) < min_len:
            out[-1]["end"] = max(out[-1]["end"], span["end"])
            continue
        out.append(span)
    return out


def transcribe_sense_voice(audio_path, language="zh", prompt="", speaker_chunks=None):
    """用 sherpa-onnx + SenseVoice（阿里）转写：中文强、速度快、自带标点。

    SenseVoice 不输出时间戳，所以按说话人分段逐段转写，
    这样每段既有时间范围也有说话人。
    """
    import soundfile as sf

    recognizer = sense_voice_recognizer()
    audio, sample_rate = sf.read(audio_path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    rows = []
    if speaker_chunks:
        for chunk in merge_spans(speaker_chunks):
            begin = int(chunk["start"] * sample_rate)
            finish = int(chunk["end"] * sample_rate)
            if finish <= begin:
                continue
            text = sense_voice_text(recognizer, audio[begin:finish], sample_rate)
            if not text:
                continue
            rows.append({
                "id": len(rows),
                "start": round(chunk["start"], 3),
                "end": round(chunk["end"], 3),
                "text": text,
                "speaker": chunk.get("speaker", ""),
            })
        return rows
    text = sense_voice_text(recognizer, audio, sample_rate)
    if text:
        rows.append({"id": 0, "start": 0.0, "end": 0.0, "text": text, "speaker": ""})
    return rows


class FunAsrWorker:
    """JSONL client for the isolated Fun-ASR Python runtime."""

    def __init__(self, python_bin, model_dir):
        self.python_bin = python_bin
        self.model_dir = model_dir
        self.process = None
        self.log_handle = None
        self.lock = __import__("threading").Lock()
        # The model stays loaded between requests. Reloading it costs about
        # thirteen seconds, which is longer than a live caption may take, so a
        # warm worker is the difference between keeping up and falling behind.
        self.recycle = False
        self.crashes = 0

    def start(self):
        if self.process is not None and self.process.poll() is None:
            return
        import subprocess

        if not self.python_bin or not Path(self.python_bin).is_file():
            raise HTTPException(status_code=500, detail="未找到 Fun-ASR Python（--fun-asr-python）")
        worker = Path(__file__).resolve().with_name("fun_asr_worker.py")
        log_dir = Path(__file__).resolve().parent / "runtime" / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        self.log_handle = open(log_dir / "fun-asr-worker.log", "a", encoding="utf-8")
        env = dict(os.environ)
        env["HF_HUB_OFFLINE"] = "1"
        env["TRANSFORMERS_OFFLINE"] = "1"
        env["HF_DATASETS_OFFLINE"] = "1"
        self.process = subprocess.Popen(
            [self.python_bin, str(worker), "--fun-asr-dir", self.model_dir],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.log_handle,
            text=True, bufsize=1, env=env,
        )

    def _exchange(self, payload):
        """Send one request and read one answer. An empty line means the worker died."""
        import select

        try:
            self.process.stdin.write(__import__("json").dumps(payload, ensure_ascii=False) + "\n")
            self.process.stdin.flush()
            ready, _, _ = select.select([self.process.stdout], [], [], STATE["timeout"])
            if not ready:
                raise HTTPException(status_code=504, detail="Fun-ASR 推理超时")
            return self.process.stdout.readline()
        except (BrokenPipeError, ValueError):
            return ""

    def request(self, audio_path, hotwords=None, language=None, itn=True):
        with self.lock:
            self.start()
            payload = {
                "audio_path": audio_path,
                "hotwords": hotwords or [],
                "language": language,
                "itn": bool(itn),
            }
            line = self._exchange(payload)
            if not line:
                # worker 意外退出（例如 MPS 内存压力）：重启后重试一次
                self.crashes += 1
                if self.crashes >= 2:
                    # 它总是崩：退回「每个请求都换一个新 worker」的保底模式。
                    self.recycle = True
                self.close()
                self.start()
                line = self._exchange(payload)
                if not line:
                    self.close()
                    raise HTTPException(status_code=500, detail="Fun-ASR worker 未返回结果，请查看 fun-asr-worker.log")
            else:
                self.crashes = 0
            try:
                response = __import__("json").loads(line)
            except ValueError as exc:
                raise HTTPException(status_code=500, detail="Fun-ASR worker 返回了无效 JSON") from exc
            if not response.get("ok"):
                raise HTTPException(status_code=500, detail=response.get("error") or "Fun-ASR 推理失败")
            if self.recycle:
                # 保底模式：每个请求用完就结束 worker，下次请求重新加载模型。
                self.close()
            return response.get("result") or {}

    def close(self):
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except __import__("subprocess").TimeoutExpired:
                self.process.kill()
        if self.log_handle is not None:
            self.log_handle.close()
            self.log_handle = None


_FUN_ASR_WORKER = None


def fun_asr_worker():
    global _FUN_ASR_WORKER
    if _FUN_ASR_WORKER is None:
        _FUN_ASR_WORKER = FunAsrWorker(STATE["fun_asr_python"], STATE["fun_asr_dir"])
    return _FUN_ASR_WORKER


def parse_hotwords(value):
    if isinstance(value, (list, tuple)):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value or "").replace("，", ",").split(",") if item.strip()]


def parse_itn(value):
    if isinstance(value, bool):
        return value
    return str(value if value is not None else "true").strip().lower() not in {"0", "false", "no", "off"}


def fun_asr_language(value):
    mapping = {"zh": "中文", "cn": "中文", "中文": "中文", "en": "英文", "英文": "英文"}
    return mapping.get(str(value or "").strip(), None)


def split_fun_asr_spans(spans, max_seconds=120.0):
    """Bound each model call while preserving whole-audio relative offsets."""
    result = []
    for span in spans:
        start = float(span["start"])
        end = float(span["end"])
        while start < end:
            finish = min(start + max_seconds, end)
            result.append({**span, "start": start, "end": finish})
            start = finish
    return result


def transcribe_fun_asr(audio_path, language="auto", hotwords=None, itn=True, speaker_chunks=None, track=None):
    """Decode ECAPA spans (or bounded fallback chunks) with offline Fun-ASR-Nano."""
    import math
    import soundfile as sf

    audio, sample_rate = sf.read(audio_path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sample_rate != 16000:
        import numpy as np
        from scipy.signal import resample_poly

        divisor = math.gcd(int(sample_rate), 16000)
        audio = resample_poly(audio, 16000 // divisor, int(sample_rate) // divisor).astype(np.float32)
        sample_rate = 16000
    duration = len(audio) / float(sample_rate)
    if duration <= 0:
        return []
    spans = merge_spans(speaker_chunks) if speaker_chunks else [{"start": 0.0, "end": duration, "speaker": ""}]
    rows = []
    words = parse_hotwords(hotwords)
    for chunk in split_fun_asr_spans(spans):
        begin = max(0, int(chunk["start"] * sample_rate))
        finish = min(len(audio), int(chunk["end"] * sample_rate))
        if finish <= begin:
            continue
        temp_path = os.path.join("/tmp", "onerway-funasr-%d-%d.wav" % (time.time_ns(), len(rows)))
        try:
            sf.write(temp_path, audio[begin:finish], sample_rate, subtype="PCM_16")
            result = fun_asr_worker().request(
                temp_path, hotwords=words, language=fun_asr_language(language), itn=parse_itn(itn),
            )
        finally:
            try:
                os.remove(temp_path)
            except OSError:
                pass
        text = (result.get("text") or "").strip()
        if not text or re.fullmatch(r"(?i)(nan|none|null)([\s,;，、]*nan)*", text):
            # 模型偶尔在无有效语音的片段上返回占位符，直接丢弃
            continue
        row = {
            "id": len(rows),
            "start": round(float(chunk["start"]), 3),
            "end": round(float(chunk["end"]), 3),
            "text": text,
            # 说话人优先用 ECAPA 分出来的标签，音轨名只是没有分人时的兜底
            "speaker": chunk.get("speaker") or track or "",
        }
        raw_timestamps = result.get("timestamps") or result.get("ctc_timestamps") or []
        timestamps = []
        for stamp in raw_timestamps:
            start = float(stamp.get("start_time", stamp.get("start", 0.0)))
            end = float(stamp.get("end_time", stamp.get("end", start)))
            timestamps.append({
                "token": str(stamp.get("token", "")),
                "start": round(float(chunk["start"]) + start, 3),
                "end": round(float(chunk["start"]) + end, 3),
            })
        if timestamps:
            row["timestamps"] = timestamps
        rows.append(row)
    return rows


def get_embedder():
    """ECAPA 说话人嵌入模型（用于聚类分说话人）。"""
    if STATE["embedder"] is None:
        try:
            import torch
            from speechbrain.inference.speaker import EncoderClassifier
        except ImportError as exc:
            raise HTTPException(
                status_code=500,
                detail="缺少说话人分离依赖：请用 skill 的 venv 运行（local_services.py setup）",
            )
        # 优先使用插件内置的 ECAPA 权重（native/asr/models/ecapa），
        # 这样说话人分离不再依赖用户 home 下的缓存，也不需要联网。
        local_ecapa = Path(__file__).resolve().parent / "models" / "ecapa"
        source = str(local_ecapa) if (local_ecapa / "hyperparams.yaml").is_file() else STATE["diarize_model"]
        savedir = str(local_ecapa / "savedir") if source == str(local_ecapa) else os.path.join(
            str(Path.home() / ".cache" / "onerway-prototype-review"), "ecapa"
        )
        STATE["embedder"] = EncoderClassifier.from_hparams(
            source,
            savedir=savedir,
            run_opts={"device": STATE["embedder_device"]},
        )
    return STATE["embedder"]


def diarize_speakers(audio_path, window=1.5, hop=0.5, min_voiced=0.6):
    """用定长窗口取说话人嵌入 → 层次聚类 → 说话人时间段。

    不用 VAD 切段（默认 2 秒静音容差会把整场会议并成一段），
    而是按能量筛出有人说话的窗口，这样不同人的声音都能被采到。
    """
    import numpy as np
    import torch
    import torchaudio
    from sklearn.cluster import AgglomerativeClustering

    waveform, sample_rate = torchaudio.load(audio_path)
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    if sample_rate != 16000:
        waveform = torchaudio.functional.resample(waveform, sample_rate, 16000)
        sample_rate = 16000
    audio = waveform.squeeze(0).numpy()
    if len(audio) < 16000:
        return []

    # 1) 用 silero VAD 找出说话区间（默认 2 秒静音容差会把整场并成一段，这里调细）
    from faster_whisper.vad import VadOptions, get_speech_timestamps
    regions = []
    try:
        for chunk in get_speech_timestamps(
            audio, VadOptions(min_silence_duration_ms=250, threshold=0.5, speech_pad_ms=100)
        ):
            regions.append((chunk["start"] / 16000.0, chunk["end"] / 16000.0))
    except Exception as exc:
        print("VAD 不可用，退回按整段切窗：%s" % exc)
        regions = [(0.0, len(audio) / 16000.0)]
    if not regions:
        return []

    # 2) 语音区间内切定长窗口（带重叠），保证每个说话人都有足够样本
    frame = 320  # 20ms
    frames = len(audio) // frame
    rms = np.sqrt((audio[: frames * frame].reshape(-1, frame) ** 2).mean(axis=1) + 1e-9) if frames else np.array([0.0])
    noise_floor = float(np.percentile(rms, 10))
    win = int(window * 16000)
    hop_len = int(hop * 16000)
    pieces = []
    for region_start, region_end in regions:
        cursor = region_start
        while cursor < region_end:
            end = min(cursor + window, region_end)
            if end - cursor < 0.6:
                break
            start = cursor
            cursor += hop
            seg_rms = rms[int(start * 16000) // frame: max(int(start * 16000) // frame + 1, int(end * 16000) // frame)]
            if len(seg_rms) == 0:
                continue
            if float(seg_rms.mean()) < noise_floor:
                continue
            pieces.append((start, end, 1.0))
    if len(pieces) < 2:
        return []

    # 3) 说话人嵌入
    embedder = get_embedder()
    embeddings = []
    for start, end, _ in pieces:
        clip = torch.from_numpy(audio[int(start * 16000):int(end * 16000)]).float().unsqueeze(0)
        with torch.no_grad():
            vector = embedder.encode_batch(clip).squeeze().numpy()
        embeddings.append(vector)
    matrix = np.asarray(embeddings)
    matrix = matrix / np.clip(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-9, None)

    # 4) 聚类
    if STATE["diarize_speakers"] and STATE["diarize_speakers"] > 0:
        from sklearn.cluster import KMeans
        labels = KMeans(n_clusters=STATE["diarize_speakers"], n_init=10, random_state=0).fit_predict(matrix)
    else:
        cluster = AgglomerativeClustering(
            n_clusters=None,
            distance_threshold=STATE["diarize_threshold"],
            metric="cosine",
            linkage="average",
        )
        labels = cluster.fit_predict(matrix)

    # 4.1) 质心最近邻合并：把碎片化的同一声音并回人数上限
    limit = STATE["diarize_speakers"] if STATE["diarize_speakers"] and STATE["diarize_speakers"] > 0 else 6
    while len(set(int(label) for label in labels)) > limit:
        groups = {}
        for index, label in enumerate(labels):
            groups.setdefault(int(label), []).append(index)
        centroids = {}
        for key, indexes in groups.items():
            centroid = matrix[indexes].mean(axis=0)
            norm = float(np.linalg.norm(centroid))
            centroids[key] = centroid / norm if norm > 1e-9 else centroid
        smallest = min(groups, key=lambda key: len(groups[key]))
        candidates = [key for key in groups if key != smallest]
        if not candidates:
            break
        target = max(candidates, key=lambda key: float(centroids[smallest] @ centroids[key]))
        for index, label in enumerate(labels):
            if int(label) == smallest:
                labels[index] = target

    names = {}
    for label in labels:
        key = int(label)
        if key not in names:
            names[key] = "发言人 %d" % (len(names) + 1)

    # 4.5) 每个说话人的平均声纹，供跨会议的声音标签识别使用
    voiceprints = {}
    for index, label in enumerate(labels):
        key = names[int(label)]
        voiceprints.setdefault(key, []).append(matrix[index])
    averaged = {}
    for key, vectors in voiceprints.items():
        centroid = np.mean(np.asarray(vectors), axis=0)
        norm = float(np.linalg.norm(centroid))
        if norm > 1e-9:
            centroid = centroid / norm
        averaged[key] = [round(float(value), 6) for value in centroid]
    STATE["voiceprints"] = averaged

    # 5) 相邻同说话人的窗口合并成时间段
    spans = []
    for index, (start, end, ratio) in enumerate(pieces):
        speaker = names[int(labels[index])]
        if spans and spans[-1]["speaker"] == speaker and start - spans[-1]["end"] < 1.2:
            spans[-1]["end"] = max(spans[-1]["end"], end)
        else:
            spans.append({"start": start, "end": end, "speaker": speaker})
    return spans


def attach_speakers(segments, speaker_chunks):
    """把说话人标签贴到 ASR 分段上（按时间重叠取占比最大的说话人）。

    已经带说话人的分段不再覆盖：sensevoice / funasr 是按说话人区间逐段转写的，
    段上的标签本来就是对的，覆盖反而会让说话人对不上。
    """
    if not speaker_chunks:
        return segments
    for segment in segments:
        if segment.get("speaker"):
            continue
        best = None
        for chunk in speaker_chunks:
            overlap = min(segment["end"], chunk["end"]) - max(segment["start"], chunk["start"])
            if overlap <= 0:
                continue
            if best is None or overlap > best[0]:
                best = (overlap, chunk["speaker"])
        if best:
            segment["speaker"] = best[1]
    return segments


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": STATE["model_name"],
        "loaded": STATE["model"] is not None,
        "load_seconds": round(STATE["load_seconds"], 2),
        "diarize": STATE["diarize"],
        "diarize_model": STATE["diarize_model"] if STATE["diarize"] else "",
        "backend": STATE["backend"],
        "whisper_cpp_model": str(find_whisper_cpp_model(STATE["whisper_cpp_model"]) or ""),
    }


@app.get("/v1/models")
def models():
    return {
        "object": "list",
        "data": [{
            "id": STATE["model_name"],
            "object": "model",
            "owned_by": "faster-whisper",
            "created": int(time.time()),
        }],
    }


@app.get("/models")
def models_no_v1():
    return models()


@app.post("/v1/audio/transcriptions")
@app.post("/audio/transcriptions")
async def transcriptions(
    file: UploadFile = File(...),
    model: str = Form("base"),
    language: str = Form(""),
    response_format: str = Form("json"),
    prompt: str = Form(""),
    hotwords: str = Form(""),
    itn: str = Form("true"),
    diarize: str = Form(""),
):
    """Pass-1 transcription: this is the live-caption path.

    说话人分离默认跟随服务设置（导入整段音频时有用），但**实时字幕必须关掉**：
    每个 3 秒分段都跑一遍 ECAPA 是在给字幕加延迟，而实时字幕本来就不显示说话人
    —— 说话人是在会议结束后由 /diarize 拿整条音轨聚类出来的。
    """
    # prompt 按请求传递：写进进程级状态会让并发请求互相覆盖热词
    effective_prompt = prompt or STATE["prompt"]
    whisper_prompt = ",".join(part for part in [effective_prompt, hotwords] if part)
    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="空音频文件")
    temp_path = os.path.join("/tmp", "onerway-asr-%d-%s" % (int(time.time() * 1000), os.path.basename(file.filename or "clip")))
    with open(temp_path, "wb") as handle:
        handle.write(payload)
    try:
        speaker_chunks = []
        want_diarize = STATE["diarize"] if not diarize else diarize.lower() not in {"false", "0", "no", "off"}
        if want_diarize:
            try:
                speaker_chunks = diarize_speakers(temp_path)
            except HTTPException:
                raise
            except Exception as exc:
                print("说话人分离失败，仅返回文本：%s" % exc)
        if STATE["backend"] == "whispercpp":
            rows = transcribe_whisper_cpp(temp_path, language or STATE["language"] or "zh", prompt=whisper_prompt)
            info = {"language": language or STATE["language"] or "zh", "duration": 0.0}
        elif STATE["backend"] == "moss":
            rows = transcribe_moss(temp_path, language or STATE["language"] or "zh", prompt=effective_prompt)
            info = {"language": language or STATE["language"] or "zh", "duration": 0.0}
        elif STATE["backend"] == "sensevoice":
            rows = transcribe_sense_voice(
                temp_path, language or STATE["language"] or "zh",
                prompt=effective_prompt, speaker_chunks=speaker_chunks if want_diarize else None,
            )
            info = {"language": language or STATE["language"] or "zh", "duration": 0.0}
        elif STATE["backend"] == "funasr":
            rows = transcribe_fun_asr(
                temp_path, language or STATE["language"] or "auto",
                hotwords=hotwords or effective_prompt, itn=parse_itn(itn),
                speaker_chunks=speaker_chunks if want_diarize else None,
            )
            info = {"language": language or STATE["language"] or "auto", "duration": 0.0}
        else:
            whisper = get_model()
            segments, info = whisper.transcribe(
                temp_path,
                language=(language or STATE["language"] or None),
                vad_filter=True,
                beam_size=STATE["beam"],
                initial_prompt=(effective_prompt or None),
            )
            rows = []
            for segment in segments:
                text = (segment.text or "").strip()
                if not text:
                    continue
                rows.append({
                    "id": len(rows),
                    "start": round(segment.start, 3),
                    "end": round(segment.end, 3),
                    "text": text,
                    "speaker": "",
                })
        attach_speakers(rows, speaker_chunks)
        plain = [row["text"] for row in rows]
        text = "".join(plain)
        if response_format == "text":
            return JSONResponse(content=text)
        result = {
            "task": "transcribe",
            "voiceprints": STATE.get("voiceprints", {}),
            "language": info.get("language") if isinstance(info, dict) else info.language,
            "duration": info.get("duration") if isinstance(info, dict) else info.duration,
            "text": text,
        }
        if response_format == "verbose_json":
            result["segments"] = rows
        return result
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass


@app.post("/finalize")
async def finalize(
    file: UploadFile = File(...),
    track: str = Form("mic"),
    hotwords: str = Form(""),
    language: str = Form("auto"),
    itn: str = Form("true"),
):
    """Pass-2 final transcription of one complete mic/system track.

    pass 2 使用独立的 Fun-ASR worker，与 pass 1 的后端无关：
    whispercpp / sensevoice 都可以做实时字幕，再用 Fun-ASR-Nano 精修最终文本。
    """
    if not STATE.get("fun_asr_dir") or not STATE.get("fun_asr_python"):
        raise HTTPException(status_code=400, detail="未配置 Fun-ASR 模型或运行时（--fun-asr-dir / --fun-asr-python）")
    if track not in {"mic", "system"}:
        raise HTTPException(status_code=400, detail="track 必须是 mic 或 system")
    started = time.time()
    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="空音频文件")
    temp_path = os.path.join("/tmp", "onerway-finalize-%d.wav" % time.time_ns())
    with open(temp_path, "wb") as handle:
        handle.write(payload)
    try:
        speaker_chunks = []
        if STATE["diarize"]:
            try:
                speaker_chunks = diarize_speakers(temp_path)
            except Exception as exc:
                # The track label remains authoritative even if ECAPA is unavailable.
                print("Fun-ASR 说话人区间不可用，按整块解码：%s" % exc)
        rows = transcribe_fun_asr(
            # The refinement pass keeps inline diarization: the speaker spans it
            # returns are what the meeting re-labels from.
            temp_path, language=language, hotwords=hotwords, itn=parse_itn(itn),
            speaker_chunks=speaker_chunks if STATE["diarize"] else None,
            track=track,
        )
        return {
            "text": "".join(row["text"] for row in rows),
            "segments": rows,
            # The clustered voices let the voice book play a voice back.
            "voiceprints": STATE.get("voiceprints", {}),
            "engine": "funasr",
            "elapsed": round(time.time() - started, 3),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Fun-ASR finalize 失败：%s" % exc) from exc
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass


@app.post("/diarize")
async def diarize(
    file: UploadFile = File(...),
    track: str = Form("mic"),
):
    """Return the speaker spans of one track without running the ASR.

    直播会议结束时用它给已经转写好的分段补上说话人：
    音轨名（mic / system）不是人，不能直接当说话人标签。
    """
    if not STATE["diarize"]:
        raise HTTPException(status_code=400, detail="未开启说话人分离")
    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="空音频文件")
    temp_path = os.path.join("/tmp", "onerway-diarize-%d.wav" % time.time_ns())
    with open(temp_path, "wb") as handle:
        handle.write(payload)
    try:
        spans = diarize_speakers(temp_path)
        return {
            "track": track,
            "spans": spans,
            "voiceprints": STATE.get("voiceprints", {}),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="说话人分离失败：%s" % exc) from exc
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8010)
    parser.add_argument("--model", default="base")
    parser.add_argument("--language", default="")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--compute", default="int8")
    parser.add_argument("--beam", type=int, default=5, help="beam size，越小越快（长会议建议 1）")
    parser.add_argument("--backend", choices=["whispercpp", "moss", "sensevoice", "funasr", "faster-whisper"], default="whispercpp",
                        help="转写后端：whispercpp / sensevoice / funasr / faster-whisper")
    parser.add_argument("--prompt", default="", help="领域术语偏置（会作为 whisper.cpp --prompt / faster-whisper initial_prompt）")
    parser.add_argument("--sense-voice-dir", default="", help="SenseVoice 模型目录（含 model.int8.onnx 与 tokens.txt）")
    parser.add_argument("--moss-model-dir", default="", help="MOSS-Transcribe-Diarize 模型目录")
    parser.add_argument("--fun-asr-dir", default=str(Path(__file__).resolve().parent / "models" / "fun-asr-nano"), help="Fun-ASR-Nano 本地快照目录")
    parser.add_argument("--fun-asr-python", default=str(Path(__file__).resolve().parent / "runtime" / "venv-funasr" / "bin" / "python"), help="Fun-ASR 独立运行时 Python")
    parser.add_argument("--no-mps", dest="use_mps", action="store_false", help="MOSS 不使用 Apple MPS")
    parser.add_argument("--whisper-cpp-bin", default="", help="whisper-cli 可执行文件路径")
    parser.add_argument("--whisper-cpp-model", default="", help="ggml 模型路径（默认自动找 ~/.cache/onerway-prototype-review/whisper-models）")
    parser.add_argument("--max-len", type=int, default=25, help="whisper.cpp 分段最大字符数")
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--no-gpu", dest="use_gpu", action="store_false", help="禁用 Metal GPU")
    parser.add_argument("--diarize", action="store_true", help="开启说话人分离（需要 torchaudio + speechbrain）")
    parser.add_argument("--diarize-threshold", type=float, default=0.68, help="聚类距离阈值，越小分得越细")
    parser.add_argument("--diarize-speakers", type=int, default=3, help="说话人数（0 表示按阈值自动判断；会议一般 2-6 人）")
    parser.add_argument("--diarize-model", default="speechbrain/spkrec-ecapa-voxceleb")
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()
    STATE["model_name"] = args.model
    STATE["language"] = args.language
    STATE["device"] = args.device
    STATE["compute_type"] = args.compute
    STATE["diarize"] = args.diarize
    STATE["backend"] = args.backend
    STATE["whisper_cpp_bin"] = args.whisper_cpp_bin
    STATE["whisper_cpp_model"] = args.whisper_cpp_model
    STATE["max_len"] = args.max_len
    STATE["threads"] = args.threads
    STATE["use_gpu"] = args.use_gpu
    STATE["prompt"] = args.prompt
    STATE["sense_voice_dir"] = args.sense_voice_dir
    STATE["moss_model_dir"] = args.moss_model_dir
    STATE["fun_asr_dir"] = args.fun_asr_dir
    STATE["fun_asr_python"] = args.fun_asr_python
    STATE["use_mps"] = args.use_mps
    STATE["diarize_threshold"] = args.diarize_threshold
    STATE["diarize_speakers"] = args.diarize_speakers
    STATE["beam"] = args.beam
    STATE["diarize_model"] = args.diarize_model
    backend_label = {
        "whispercpp": "whisper.cpp·Metal",
        "sensevoice": "sherpa-onnx·SenseVoice",
        "funasr": "Fun-ASR-Nano·offline",
        "moss": "MOSS-Transcribe-Diarize",
        "faster-whisper": "faster-whisper·CPU",
    }.get(args.backend, args.backend)
    print("本地 ASR 服务：http://%s:%d/v1 （后端 %s，模型 %s%s）" % (
        args.host, args.port, backend_label, args.model,
        "，说话人分离已开启（%d 人）" % args.diarize_speakers if args.diarize else ""))
    __import__("atexit").register(lambda: _FUN_ASR_WORKER.close() if _FUN_ASR_WORKER else None)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
