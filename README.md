# 舞美三维查看

把舞美 3D 模型（3ds Max 导出的 FBX，或 GLB）做成一个单文件 html：双击即可在浏览器里三维浏览、第一人称走动、坐到观众席看舞台、操作升降屏、放转播机位。另有「秀导走位」版，用来摆人、画走位、按音乐分轨调时间。

## 设计师用：生成器网页

`dist/舞美生成器.html`（`node build.mjs` 生成）：打开后拖入模型 → 确认灯具桌椅 → 填项目名称、观众席方向 → 下载 html。全部在浏览器里完成，模型不上传。给设计师的说明在 `docs/模型准备说明.md`，也内嵌在生成器的「模型准备说明」里。

中英双语：生成器右上角切换（默认跟浏览器语言，`?lang=en` / `?lang=zh` 可指定），生成的网页用当时的语言。界面翻译在 `src/i18n.js`（中文写在代码里，英文查表）；英文版说明是 `docs/model-guide.en.md`。

## 生成 html（只要 Python 3）

```bash
python3 skill/stage-viewer/scripts/build_html.py 模型.fbx -c 配置.json -o dist/舞美三维查看.html
python3 skill/stage-viewer/scripts/build_html.py --show --title "演出名称" -o dist/秀导走位.html
python3 skill/stage-viewer/scripts/build_html.py 模型.fbx --inspect   # 列出构件名、检查贴图是否嵌入
```

配置字段见 `skill/stage-viewer/SKILL.md` 的「配置」一节，示例见 `skill/stage-viewer/examples/stage.config.json`。

## 改功能（要 Node.js）

```bash
npm install
node build.mjs   # src/ → skill/stage-viewer/assets/viewer-template.html，并打包 dist/stage-viewer-skill.zip
```

`build.mjs` 把 three.js 和 `src/` 打包进模板，模型和配置的位置留空；`build_html.py` 再把 FBX（gzip + base64）和配置注入进去。

## 目录

- `src/fbx.js`：读 FBX、自动识别灯具桌椅、生成配置、精简（与 `fbx_strip.py` 算法一致，输出逐字节相同）
- `src/generator.js`、`src/generator.html`：生成器网页
- `src/`：查看器源码（`main.js` 入口，`cameras.js` 机位，`director.js` 导摄，`props.js` 桌椅，`show.js` 秀导走位，`template.html` 页面和 CSS）
- `src/vendor/FBXLoader.js`：three.js 的 FBX 读取器（MIT），打过补丁以读取 3ds Max / V-Ray 材质参数
- `skill/stage-viewer/`：Python 生成脚本和给 AI 用的说明
- `dev/`：分析模型材质、构件尺寸的小工具

## 说明

本项目以 MIT 许可证开源，见 `LICENSE`。内含 [three.js](https://github.com/mrdoob/three.js)（MIT），`src/vendor/FBXLoader.js` 改自 three.js 自带的 FBX 读取器。

机位功能参考了 OpenShotDesigner（GPL）的思路，没有使用它的代码；以后修改也不要复制它的代码。
