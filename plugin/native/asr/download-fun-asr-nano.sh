#!/usr/bin/env bash
# 下载 Fun-ASR-Nano（SenseVoiceEncoderSmall + Qwen3-0.6B）到插件内，供 pass 2 精修使用。
# 支持断点续传；镜像地址可通过 HF_ENDPOINT 覆盖。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${FUN_ASR_DIR:-$ROOT_DIR/models/fun-asr-nano}"
ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
REPO="${FUN_ASR_REPO:-FunAudioLLM/Fun-ASR-Nano-2512}"
BASE_URL="$ENDPOINT/$REPO/resolve/main"

FILES=(
  "config.yaml"
  "configuration.json"
  "multilingual.tiktoken"
  "model.pt"
  "Qwen3-0.6B/config.json"
  "Qwen3-0.6B/generation_config.json"
  "Qwen3-0.6B/merges.txt"
  "Qwen3-0.6B/tokenizer.json"
  "Qwen3-0.6B/tokenizer_config.json"
  "Qwen3-0.6B/vocab.json"
)

mkdir -p "$TARGET_DIR"

for file in "${FILES[@]}"; do
  destination="$TARGET_DIR/$file"
  mkdir -p "$(dirname "$destination")"
  if [ -s "$destination" ]; then
    echo "已存在，跳过：$file"
    continue
  fi
  echo "下载：$file"
  curl --fail --location --continue-at - --retry 5 --retry-delay 3 \
    --output "$destination.part" "$BASE_URL/$file"
  mv "$destination.part" "$destination"
done

echo "完成：$TARGET_DIR"
