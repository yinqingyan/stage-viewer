#!/bin/sh
# 发布生成器到 GitHub Pages：重新打包，把 dist/舞美生成器.html 作为 index.html 强制推到 gh-pages 分支。
# 仓库 Settings → Pages 里选 Deploy from a branch → gh-pages / (root)。
set -e
cd "$(dirname "$0")"
node build.mjs
tmp=$(mktemp -d)
cp "dist/舞美生成器.html" "$tmp/index.html"
cp -r dist/video "$tmp/video"
touch "$tmp/.nojekyll"
git -C "$tmp" init -q -b gh-pages
git -C "$tmp" add -A
git -C "$tmp" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" commit -q -m "发布生成器 $(git rev-parse --short HEAD)"
git -C "$tmp" -c core.sshCommand="$(git config core.sshCommand)" push -q -f "$(git remote get-url origin)" gh-pages
rm -rf "$tmp"
echo "已推到 gh-pages 分支"
