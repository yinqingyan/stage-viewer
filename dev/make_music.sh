#!/bin/sh
# 开发工具：用 ElevenLabs Music 生成演示视频的配乐（纯音乐，没有人声）。
# 用法：sh dev/make_music.sh 秒数 输出.mp3
# key 放在 ~/.config/elevenlabs/key（以 sk_ 开头），不进仓库。
set -e
secs=$1 out=$2
[ -n "$secs" ] && [ -n "$out" ] || { echo "用法：sh dev/make_music.sh 秒数 输出.mp3"; exit 1; }
key=$(cat ~/.config/elevenlabs/key)
# 演示视频的节奏：开头片名、中间一个个功能、结尾片尾压黑，所以要开头起得快、结尾能收住
prompt="Modern, confident instrumental background music for a short software product demo video about a 3D stage design tool. \
Warm cinematic electronic: soft synth pads, plucked arpeggios, light punchy drums, subtle bass, around 110 BPM, uplifting and clean. \
Starts within the first second, steady groove in the middle without big drops, and a clear resolved ending in the last few seconds. No vocals."
body=$(python3 -c "import json, sys; print(json.dumps({'prompt': sys.argv[1], 'music_length_ms': int(float(sys.argv[2]) * 1000), 'force_instrumental': True}))" "$prompt" "$secs")
code=$(curl -s -o "$out" -w '%{http_code}' -X POST 'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192' \
  -H "xi-api-key: $key" -H 'Content-Type: application/json' -d "$body")
[ "$code" = 200 ] || { echo "ElevenLabs 返回 $code："; cat "$out"; echo; rm -f "$out"; exit 1; }
echo "配乐：$out"
