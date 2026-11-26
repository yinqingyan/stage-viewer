# 更新日志

生成器网页：https://yinqingyan.github.io/stage-viewer/ 。用新版重新生成一次，查看器就有新功能。

## 2026-11-26

- **观众视角**：底部「观众视角」切到平面图，点一个座位就坐过去看：坐姿眼高、面朝屏幕，上方显示离屏幕多少米。「最左」「最右」「最后一排」一键坐到视角最偏、最远的位置，方便检查最差的座位。模型里认不出座位时，点地面也能以坐着的高度看。
- **截图**：底部相机图标，把当前画面存成 2 倍清晰度的 PNG，不带按钮和面板，可以直接放进方案。
- **环绕视频**：相机图标旁的摄像机图标，选角度（90° / 180° / 360°）、时长（10 / 20 / 30 秒）和方向，从当前视角绕一圈录成视频，不带界面。浏览器支持时存 mp4，否则存 webm；需要电脑上的 Chrome、Edge 或 Safari。
- **表面材质**：点地面、台面等构件，在信息卡里换成地毯、水泥、木地板、地胶或亮面，颜色可选。同一材质的构件一起换。纹理按真实尺寸铺贴，SketchUp、Rhino 导出的没展 UV 的模型也能用。改完点右侧「保存为新文件」，下载一个带着这些改动的新 html，发给别人打开就是这个样子。

<!-- en：build.mjs 从这里切开，上面是中文、下面是英文，生成器网页「最近更新」按语言显示 -->

# Changelog

Generator page: https://yinqingyan.github.io/stage-viewer/ . Generate your file again with the new version to get the new viewer features.

## 2026-11-26

- **Seat view**: switch to the plan, click a seat and you sit there at seated eye height, facing the screen, with the distance to the screen shown. **Far left**, **Far right** and **Back row** jump to the worst seats in one click. If no seats are recognised, click the floor to look from seated height.
- **Screenshot**: the camera icon saves the current view as a 2× PNG without the interface.
- **Orbit video**: the video icon records a 90° / 180° / 360° turn from the current view in 10, 20 or 30 seconds, without the interface. Saves mp4 where the browser supports it, otherwise webm; needs Chrome, Edge or Safari on a computer.
- **Surfaces**: click a floor or deck and turn it into carpet, concrete, wood, dance floor or gloss, in any colour. Parts sharing a material change together. Textures are laid at real-world scale, so models without UVs (SketchUp, Rhino) work too. **Save as new file** downloads a new html with your changes, so whoever you send it to sees the same thing.
