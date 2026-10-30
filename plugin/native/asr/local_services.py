#!/usr/bin/env python3
"""本地模型服务编排：探测、启动、停止、列模型。

评审壳的转写与纪要都可以走本机服务，这个脚本负责把服务拉起来并告诉
评审壳「本机有什么可用」。

用法：
    python3 .claude/skills/prototype-design/scripts/local_services.py status
    python3 .claude/skills/prototype-design/scripts/local_services.py start asr [--port 8010 --model base]
    python3 .claude/skills/prototype-design/scripts/local_services.py stop asr
    python3 .claude/skills/prototype-design/scripts/local_services.py models
"""

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ASR_SERVER = Path(__file__).resolve().with_name("local_asr_server.py")
STATE_DIR = Path(__file__).resolve().parent / "runtime"
LOG_DIR = STATE_DIR / "logs"
VENV_DIR = STATE_DIR / "venv"
VENV_PYTHON = VENV_DIR / "bin" / "python"

# 候选端点：名称 → (base_url, 类型, 说明)
ENDPOINTS = [
    ("本地 ASR（faster-whisper）", "http://127.0.0.1:8010", "asr", "本 skill 自带，OpenAI 兼容转写"),
    ("本机 whisper.cpp", "http://127.0.0.1:8080", "asr", "whisper-server，需自备 ggml 模型"),
    ("本机自建 ASR", "http://127.0.0.1:8000", "asr", "任意 OpenAI 兼容 ASR"),
    ("LM Studio", "http://127.0.0.1:1234/v1", "llm", "LM Studio 本地服务器"),
    ("Ollama", "http://127.0.0.1:11434/v1", "llm", "Ollama 本地服务"),
    ("vLLM", "http://127.0.0.1:8000/v1", "llm", "vLLM OpenAI 兼容服务"),
]


def probe(base, kind, timeout=2.0):
    """Return {ok, models[], detail} for one endpoint."""
    url = base.rstrip("/")
    if kind == "asr" and url.endswith("/v1"):
        url = url[:-3]
    if kind == "asr":
        health = url + "/health"
        try:
            with urllib.request.urlopen(health, timeout=timeout) as res:
                detail = res.read().decode("utf-8", "ignore")[:200]
                return {"ok": True, "models": [], "detail": detail}
        except Exception:
            pass
    try:
        with urllib.request.urlopen(url + "/models", timeout=timeout) as res:
            data = json.loads(res.read().decode("utf-8", "ignore"))
            models = [item.get("id") or item.get("name") for item in (data.get("data") or data.get("models") or [])]
            return {"ok": True, "models": [m for m in models if m], "detail": ""}
    except urllib.error.HTTPError as exc:
        return {"ok": False, "models": [], "detail": "HTTP %s" % exc.code}
    except Exception as exc:
        return {"ok": False, "models": [], "detail": str(exc)[:80]}


def cmd_status(args):
    rows = []
    for name, base, kind, note in ENDPOINTS:
        result = probe(base, kind)
        rows.append({
            "name": name,
            "kind": kind,
            "base": base,
            "note": note,
            "alive": result["ok"],
            "models": result["models"],
            "detail": result["detail"],
        })
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return 0
    print("本机模型服务探测：")
    for row in rows:
        flag = "✓ 在线" if row["alive"] else "× 未启动"
        print("  %-26s %-4s %-28s %s" % (row["name"], row["kind"], row["base"], flag))
        if row["models"]:
            print("      可用模型：%s" % "、".join(row["models"][:8]))
        if row["alive"] and row["detail"] and not row["models"]:
            print("      %s" % row["detail"][:100])
    print()
    print("提示：本地 ASR 可用 `start asr` 启动；LM Studio 需要在 GUI 里开启 Local Server（默认端口 1234）。")
    return 0


def cmd_start(args):
    if args.service != "asr":
        print("目前只支持启动本地 ASR。LM Studio 请在 GUI 里开启 Local Server；Ollama 用 `ollama serve`。")
        return 1
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    pid_file = STATE_DIR / "asr.pid"
    if pid_file.exists():
        pid = int(pid_file.read_text().strip() or 0)
        if pid and pid_alive(pid):
            print("本地 ASR 已在运行（pid %d）" % pid)
            return 0
    python_bin = str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable
    cmd = [
        python_bin, str(ASR_SERVER),
        "--host", args.host,
        "--port", str(args.port),
        "--model", args.model,
        "--backend", args.backend,
    ]
    if args.backend == "whispercpp" and args.cpp_model:
        cmd += ["--whisper-cpp-model", args.cpp_model]
    if args.backend == "sensevoice" and args.sense_voice_dir:
        cmd += ["--sense-voice-dir", args.sense_voice_dir]
    if args.backend == "funasr":
        cmd += ["--fun-asr-dir", args.fun_asr_dir, "--fun-asr-python", args.fun_asr_python]
    if args.backend == "moss" and args.moss_model_dir:
        cmd += ["--moss-model-dir", args.moss_model_dir]
    if args.prompt:
        cmd += ["--prompt", args.prompt]
    if args.language:
        cmd += ["--language", args.language]
    if args.diarize:
        cmd += ["--diarize", "--diarize-threshold", str(args.threshold),
                "--diarize-speakers", str(args.speakers)]
    if args.beam:
        cmd += ["--beam", str(args.beam)]
    log_path = LOG_DIR / ("asr-%d.log" % int(time.time()))
    handle = open(log_path, "wb")
    env = dict(os.environ)
    env["HF_HOME"] = str(STATE_DIR / "huggingface")
    env["TORCH_HOME"] = str(STATE_DIR / "torch")
    if args.backend == "funasr":
        env["HF_HUB_OFFLINE"] = "1"
        env["TRANSFORMERS_OFFLINE"] = "1"
        env["HF_DATASETS_OFFLINE"] = "1"
    proc = subprocess.Popen(cmd, stdout=handle, stderr=subprocess.STDOUT, start_new_session=True, env=env)
    pid_file.write_text(str(proc.pid))
    print("本地 ASR 启动中（pid %d，端口 %d，模型 %s）" % (proc.pid, args.port, args.model))
    for _ in range(40):
        time.sleep(0.5)
        if probe("http://127.0.0.1:%d" % args.port, "asr")["ok"]:
            print("已就绪：http://127.0.0.1:%d/v1/audio/transcriptions" % args.port)
            print("日志：%s" % log_path)
            return 0
    print("启动超时，请查看日志：%s" % log_path)
    return 1


def cmd_stop(args):
    pid_file = STATE_DIR / "asr.pid"
    if not pid_file.exists():
        print("没有正在运行的本地 ASR")
        return 0
    pid = int(pid_file.read_text().strip() or 0)
    if pid and pid_alive(pid):
        os.kill(pid, signal.SIGTERM)
        print("已停止本地 ASR（pid %d）" % pid)
    else:
        print("进程已不存在")
    pid_file.unlink(missing_ok=True)
    return 0


def cmd_models(args):
    print("LM Studio 已下载模型：")
    root = Path.home() / ".lmstudio" / "models"
    found = 0
    if root.is_dir():
        for gguf in sorted(root.glob("**/*.gguf")):
            size_gb = gguf.stat().st_size / 1024 / 1024 / 1024
            print("  %6.2f GB  %s" % (size_gb, gguf.relative_to(root)))
            found += 1
    if not found:
        print("  （没有找到 .gguf，LM Studio 可能把模型放在其它目录）")

    print()
    print("HuggingFace 缓存里的 Unsloth / 语音模型：")
    hub = Path.home() / ".cache" / "huggingface" / "hub"
    if hub.is_dir():
        for item in sorted(hub.glob("models--*")):
            name = item.name[len("models--"):]
            if any(key in name.lower() for key in ("unsloth", "whisper", "asr", "tts", "orpheus", "bge", "snac")):
                size = sum(f.stat().st_size for f in item.rglob("*") if f.is_file())
                print("  %6.2f GB  %s" % (size / 1024 / 1024 / 1024, name))
    else:
        print("  （没有 HF 缓存目录）")
    return 0


def cmd_setup(args):
    """准备独立 venv：装说话人分离依赖，不污染全局 Python。"""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    if not VENV_PYTHON.exists():
        print("创建 venv：%s" % VENV_DIR)
        subprocess.check_call([sys.executable, "-m", "venv", "--system-site-packages", str(VENV_DIR)])
    print("安装依赖：torchaudio + speechbrain（继承系统 torch / faster-whisper / sklearn）")
    subprocess.check_call([
        str(VENV_PYTHON), "-m", "pip", "install", "-q", "--disable-pip-version-check",
        "torchaudio==2.6.0", "speechbrain",
    ])
    subprocess.check_call([
        str(VENV_PYTHON), "-c",
        "import torch, torchaudio, speechbrain, faster_whisper, sklearn; "
        "print('  torch', torch.__version__, '| torchaudio', torchaudio.__version__, "
        "'| speechbrain', speechbrain.__version__, '| faster-whisper ok | sklearn ok')",
    ])
    print("完成。启动带说话人分离的本地 ASR：")
    print("  %s start asr --diarize --model large-v3-turbo" % sys.argv[0])
    return 0


def cmd_key(args):
    """把本机 DSH 凭据里的 MiniMax Key 复制到剪贴板（不打印明文）。"""
    path = Path.home() / ".dsh" / ".credentials.yaml"
    if not path.is_file():
        print("未找到 %s" % path)
        return 1
    raw = path.read_text(encoding="utf-8", errors="ignore")
    match = re.search(r"^\s*MYMINIMAX_API_KEY:\s*(.+?)\s*$", raw, re.M)
    if not match:
        print("凭据文件里没有 MYMINIMAX_API_KEY")
        return 1
    key = match.group(1).strip().strip('"').strip("'")
    if args.show:
        print(key)
        return 0
    try:
        proc = subprocess.run(["pbcopy"], input=key.encode("utf-8"), check=True)
        print("MiniMax Key 已复制到剪贴板（长度 %d），粘贴到评审壳「API Key」即可" % len(key))
    except Exception as exc:
        print("复制失败：%s（加 --show 直接打印）" % exc)
        return 1
    return 0


def pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    status = sub.add_parser("status", help="探测本机可用的模型服务")
    status.add_argument("--json", action="store_true")
    status.set_defaults(run=cmd_status)

    start = sub.add_parser("start", help="启动本地服务")
    start.add_argument("service", choices=["asr"])
    start.add_argument("--port", type=int, default=8010)
    start.add_argument("--host", default="127.0.0.1")
    start.add_argument("--model", default="base", help="faster-whisper 模型：base/small/medium/large-v3")
    start.add_argument("--language", default="")
    start.add_argument("--diarize", action="store_true", help="开启说话人分离（首次会自动下载嵌入模型）")
    start.add_argument("--threshold", type=float, default=0.82, help="自动分人的聚类阈值（--diarize-speakers 0 时生效）")
    start.add_argument("--speakers", type=int, default=3, help="说话人数，会议一般 2-6 人")
    start.add_argument("--beam", type=int, default=5, help="beam size，长会议建议 1 换速度")
    start.add_argument("--backend", choices=["whispercpp", "moss", "sensevoice", "funasr", "faster-whisper"], default="whispercpp",
                       help="转写后端：whispercpp / sensevoice / funasr / faster-whisper")
    start.add_argument("--prompt", default="", help="领域术语偏置，如 'KYC、KYB、流程引擎、进件'")
    start.add_argument("--sense-voice-dir", default="", help="SenseVoice 模型目录")
    start.add_argument("--moss-model-dir", default="", help="MOSS-Transcribe-Diarize 模型目录")
    start.add_argument("--fun-asr-dir", default=str(Path(__file__).resolve().parent / "models" / "fun-asr-nano"), help="Fun-ASR-Nano 本地快照目录")
    start.add_argument("--fun-asr-python", default=str(STATE_DIR / "venv-funasr" / "bin" / "python"), help="Fun-ASR 独立运行时 Python")
    start.add_argument("--cpp-model", default="", help="ggml 模型路径，默认自动找缓存目录")
    start.set_defaults(run=cmd_start)

    stop = sub.add_parser("stop", help="停止本地服务")
    stop.add_argument("service", choices=["asr"])
    stop.set_defaults(run=cmd_stop)

    models = sub.add_parser("models", help="列出本机已下载的模型")
    models.set_defaults(run=cmd_models)

    setup = sub.add_parser("setup", help="准备独立 venv（说话人分离依赖），不污染全局环境")
    setup.set_defaults(run=cmd_setup)

    key = sub.add_parser("key", help="把本机 MiniMax Key 复制到剪贴板")
    key.add_argument("--show", action="store_true", help="直接打印而不是复制")
    key.set_defaults(run=cmd_key)

    args = parser.parse_args()
    return args.run(args) or 0


if __name__ == "__main__":
    sys.exit(main())
