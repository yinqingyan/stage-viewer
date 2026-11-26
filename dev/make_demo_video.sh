#!/bin/sh
# 开发工具：从头录一版演示视频（中文或英文），拼好、配上音乐，输出 docs/video/demo-<语言>.mp4。
# 用法：sh dev/make_demo_video.sh zh|en 工作目录 [音乐.mp3]
#   1. 主体：dev/record_demo.mjs（生成器 → 查看器各功能 → 片尾），片尾第一帧写在 end.txt
#   2. 「发给客户」：先用 dev/record_devices.mjs 录电脑、手机画面，再用 dev/record_share.mjs 合成
#   3. 拼接：主体到片尾前 → 交叉淡化 → 发给客户 → 交叉淡化 → 片尾（跳过片尾开头还在淡入的几帧）
#   音乐用 dev/make_music.sh 生成；不给就是无声视频。音乐开头淡入、结尾跟着画面淡出。
# ffmpeg 用 pip 装的 imageio-ffmpeg 里的（系统没有 ffmpeg）。
set -e
cd "$(dirname "$0")/.."
lang=$1 work=$2 music=$3
[ "$lang" = zh ] || [ "$lang" = en ] || { echo "用法：sh dev/make_demo_video.sh zh|en 工作目录 [音乐.mp3]"; exit 1; }
FF=$(python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
mkdir -p "$work"
work=$(cd "$work" && pwd)

node build.mjs > /dev/null
node dev/record_demo.mjs dist/舞美生成器.html 测试模型/演示舞台.fbx "$work/demo" "$lang"
html="$work/demo/dl/$(cat "$work/demo/html.txt")"
# 「发给客户」一段和查看器新功能无关，录过就不再录（要重录就删掉 工作目录/share）
if [ ! -f "$work/share/f0374.jpg" ]; then
  node dev/record_devices.mjs "$html" "$work/desk" desktop 11
  node dev/record_devices.mjs "$html" "$work/phone" phone 11
  node dev/record_share.mjs "$work/desk" "$work/phone" "$work/share" "$lang"
fi

FPS=25 X=0.4 SKIP=12   # 交叉淡化 0.4 秒；片尾前 12 帧是从画面淡入，跳过
E=$(cat "$work/demo/end.txt")
N=$(ls "$work/demo" | grep -c '^f[0-9]*\.jpg$')
S=$(ls "$work/share" | grep -c '^f[0-9]*\.jpg$')
o1=$(echo "$E / $FPS - $X" | bc -l)
o2=$(echo "$o1 + $S / $FPS - $X" | bc -l)
total=$(echo "$o2 + ($N - $E - $SKIP) / $FPS" | bc -l)
v="[0]split[m1][m2];[m1]trim=end_frame=$E,setpts=PTS-STARTPTS[a];[m2]trim=start_frame=$((E + SKIP)),setpts=PTS-STARTPTS[c];"
v="$v[a][1]xfade=transition=fade:duration=$X:offset=$o1[ab];[ab][c]xfade=transition=fade:duration=$X:offset=$o2,format=yuv420p[v]"
out="docs/video/demo-$lang.mp4"
if [ -n "$music" ]; then
  fo=$(echo "$total - 2.5" | bc -l)
  "$FF" -y -loglevel error -framerate $FPS -i "$work/demo/f%04d.jpg" -framerate $FPS -i "$work/share/f%04d.jpg" -i "$music" \
    -filter_complex "$v;[2:a]atrim=0:$total,afade=t=in:d=0.6,afade=t=out:st=$fo:d=2.5,volume=0.85[m]" -map "[v]" -map "[m]" \
    -c:v libx264 -crf 18 -preset slow -c:a aac -b:a 192k -movflags +faststart "$out"
else
  "$FF" -y -loglevel error -framerate $FPS -i "$work/demo/f%04d.jpg" -framerate $FPS -i "$work/share/f%04d.jpg" \
    -filter_complex "$v" -map "[v]" -c:v libx264 -crf 18 -preset slow -movflags +faststart "$out"
fi
printf '%s：%.1f 秒\n' "$out" "$total"
