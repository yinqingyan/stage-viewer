// 30 秒说明动画：导出模型前要注意的 4 件事（嵌入的媒体、二进制和单位、灯具编组、机械动画）。
// 画面是 1280×720 的舞台，按容器缩放；每一帧只由时间 t（秒）决定（render(t)），
// 所以既能实时播放，也能逐帧截图导出视频。
const W = 1280, H = 720, LEN = 30;
const clamp = x => Math.max(0, Math.min(1, x));
const ease = x => { x = clamp(x); return x < .5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2; };
const prog = (t, a, b) => ease((t - a) / (b - a));
// 一段场景的可见度：a 开始淡入，b 开始淡出
const vis = (t, a, b, f = .4) => clamp((t - a) / f) * clamp((b - t) / f);

const SCENES = [
  { a: 0, b: 4 }, { a: 4, b: 10, n: 1, cap: '勾选「嵌入的媒体」，屏幕画面才会显示' },
  { a: 10, b: 15, n: 2, cap: '格式选「二进制」，单位用厘米或米' },
  { a: 15, b: 21, n: 3, cap: '每台灯一个组，同款灯复制；外层组名就是灯光开关' },
  { a: 21, b: 27, n: 4, cap: '会动的东西编成组，第 0 帧和最后一帧打关键帧，导出勾「动画」' },
  { a: 27, b: 30.5 },
];

const CSS = `
.ex { position:relative; width:100%; aspect-ratio:16/9; overflow:hidden; border-radius:14px; background:#0a0b0f; container-type:inline-size; }
.ex-stage { position:absolute; left:0; top:0; width:${W}px; height:${H}px; transform-origin:0 0; color:#eef0f5; font-family:-apple-system,"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif; }
.ex-stage * { box-sizing:border-box; }
.ex-l { position:absolute; will-change:opacity,transform; }
.ex-beam { position:absolute; top:-60px; width:260px; height:760px; transform-origin:50% 0; filter:blur(22px); clip-path:polygon(42% 0,58% 0,100% 100%,0 100%); }
.ex-cap { left:0; right:0; bottom:64px; text-align:center; font-size:34px; font-weight:700; letter-spacing:.02em; }
.ex-num { display:inline-grid; place-items:center; width:46px; height:46px; margin-right:14px; border-radius:50%; background:linear-gradient(135deg,#7b8cff,#b07cff); font-size:26px; vertical-align:middle; }
.ex-bar { left:0; bottom:0; height:6px; background:linear-gradient(90deg,#7b8cff,#b07cff); }
.ex-card { background:#151820; border:1px solid rgba(255,255,255,.12); border-radius:18px; padding:26px 30px; font-size:26px; }
.ex-card h4 { margin:0 0 18px; font-size:22px; color:#8e94a4; font-weight:500; }
.ex-row { display:flex; align-items:center; gap:16px; margin-top:14px; }
.ex-box { width:38px; height:38px; border:3px solid #8e94a4; border-radius:8px; display:grid; place-items:center; font-size:28px; color:#46d39a; flex:none; }
.ex-ok { color:#46d39a; } .ex-bad { color:#ff7d72; } .ex-dim { color:#8e94a4; } .ex-gold { color:#ffd28a; }
.ex-screen { width:420px; height:240px; border-radius:10px; border:6px solid #2a2e38; }
.ex-tree div { margin:8px 0; }
.ex-sw { padding:14px 22px; border-radius:12px; background:#33507f; font-size:26px; display:flex; justify-content:space-between; width:360px; }
.ex-play { position:absolute; inset:0; display:grid; place-items:center; background:rgba(10,11,15,.55); cursor:pointer; border:0; color:#fff; font:inherit; font-size:20px; }
.ex-play[hidden] { display:none; }
.ex-play span { display:grid; place-items:center; width:84px; height:84px; border-radius:50%; background:linear-gradient(135deg,#7b8cff,#b07cff); font-size:34px; margin:0 auto 12px; padding-left:6px; }
`;

const HTML = `
<div class="ex-beam" style="left:120px;transform:rotate(-20deg);background:linear-gradient(rgba(255,226,170,.45),transparent 75%)"></div>
<div class="ex-beam" style="left:430px;transform:rotate(-6deg);background:linear-gradient(rgba(140,160,255,.4),transparent 75%)"></div>
<div class="ex-beam" style="right:430px;transform:rotate(6deg);background:linear-gradient(rgba(186,130,255,.38),transparent 75%)"></div>
<div class="ex-beam" style="right:120px;transform:rotate(20deg);background:linear-gradient(rgba(255,226,170,.45),transparent 75%)"></div>

<div class="ex-l" data-s="0" style="left:0;right:0;top:230px;text-align:center">
  <div style="font-size:24px;letter-spacing:.3em;color:#ffd28a">30 秒说明</div>
  <div style="font-size:64px;font-weight:800;margin-top:18px">导出模型前，看懂这 4 件事</div>
  <div class="ex-dim" style="font-size:28px;margin-top:18px">做对了，生成的网页才好看、才会动</div>
</div>

<!-- ① 嵌入的媒体 -->
<div class="ex-l ex-card" data-s="1" style="left:110px;top:150px;width:470px">
  <h4>3ds Max · 导出 FBX</h4>
  <div class="ex-row"><div class="ex-box" id="exChk1"></div><b>嵌入的媒体</b></div>
  <div class="ex-row ex-dim"><div class="ex-box"></div>动画</div>
  <div class="ex-row ex-dim"><div class="ex-box"></div>摄影机</div>
</div>
<div class="ex-l" data-s="1" style="left:700px;top:140px">
  <div class="ex-screen" id="exScr" style="background:#f4f4f4"></div>
  <div id="exScrTxt" style="margin-top:16px;font-size:28px;text-align:center"></div>
</div>

<!-- ② 二进制、单位 -->
<div class="ex-l ex-card" data-s="2" style="left:110px;top:160px;width:470px">
  <h4>导出设置</h4>
  <div class="ex-row">文件格式 <b class="ex-gold" style="margin-left:auto">二进制</b></div>
  <div class="ex-row">单位 <b class="ex-gold" id="exUnit" style="margin-left:auto"></b></div>
</div>
<div class="ex-l" data-s="2" style="left:690px;top:110px;width:480px;height:360px">
  <div style="position:absolute;left:0;right:0;bottom:40px;height:16px;background:#5a5f6c;border-radius:4px"></div>
  <div style="position:absolute;left:60px;bottom:56px;width:150px;height:200px;background:linear-gradient(135deg,#7b8cff,#b07cff);border-radius:6px"></div>
  <div id="exMan" style="position:absolute;left:300px;bottom:56px;width:30px;height:150px;transform-origin:50% 100%">
    <div style="width:30px;height:30px;border-radius:50%;background:#ff9a3c;margin:0 auto"></div>
    <div style="width:30px;height:116px;border-radius:14px;background:#ff9a3c;margin-top:4px"></div>
  </div>
  <div id="exManTxt" style="position:absolute;left:0;right:0;bottom:-12px;text-align:center;font-size:26px"></div>
</div>

<!-- ③ 灯具编组 -->
<div class="ex-l ex-card ex-tree" data-s="3" style="left:110px;top:120px;width:480px">
  <h4>3ds Max 场景</h4>
  <div class="ex-gold">▾ 📁 天排光束</div>
  <div id="exLamps"></div>
</div>
<div class="ex-l" data-s="3" style="left:700px;top:150px">
  <div style="display:flex;gap:26px;margin-bottom:40px" id="exGlow"></div>
  <div class="ex-dim" style="font-size:22px;margin-bottom:10px">生成的网页 · 灯光面板</div>
  <div class="ex-sw" id="exSw"><span>天排光束</span><span class="ex-dim" id="exSwN"></span></div>
</div>

<!-- ④ 机械动画 -->
<div class="ex-l" data-s="4" style="left:110px;top:110px;width:1060px">
  <div style="position:relative;height:300px">
    <div style="position:absolute;left:300px;right:300px;bottom:0;height:20px;background:#5a5f6c;border-radius:4px"></div>
    <div id="exLift" style="position:absolute;left:470px;width:120px;height:22px;bottom:0;background:#ffd28a;border-radius:4px"></div>
    <div id="exLiftTxt" class="ex-gold" style="position:absolute;left:610px;font-size:24px"></div>
  </div>
  <div style="position:relative;margin-top:40px;height:60px;background:#151820;border:1px solid rgba(255,255,255,.12);border-radius:12px">
    <div style="position:absolute;left:40px;top:14px;width:28px;height:28px;background:#ffd28a;transform:rotate(45deg)"></div>
    <div style="position:absolute;right:40px;top:14px;width:28px;height:28px;background:#ffd28a;transform:rotate(45deg)"></div>
    <div id="exHead" style="position:absolute;top:-10px;width:4px;height:80px;background:#ff7d72"></div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-top:10px;font-size:24px" class="ex-dim"><span>第 0 帧：初始位置</span><span>最后一帧：运动到头</span></div>
</div>

<!-- 结尾 -->
<div class="ex-l" data-s="5" style="left:0;right:0;top:200px;text-align:center">
  <div style="display:flex;justify-content:center;align-items:center;gap:40px;font-size:30px">
    <div class="ex-card" id="exFbx">舞美.fbx</div><div class="ex-gold" style="font-size:44px">→</div>
    <div class="ex-card">生成器</div><div class="ex-gold" style="font-size:44px">→</div>
    <div class="ex-card ex-ok" id="exHtml">舞美.html</div>
  </div>
  <div style="font-size:40px;font-weight:800;margin-top:50px">拖进生成器，下载 html，双击打开</div>
  <div class="ex-dim" style="font-size:24px;margin-top:22px">有问题直接联系 stageviewer.app@outlook.com</div>
</div>

<div class="ex-l ex-cap" id="exCap"></div>
<div class="ex-l ex-bar" id="exBar"></div>
`;

export function mountExplainer(host) {
  if (!document.getElementById('ex-css')) document.head.insertAdjacentHTML('beforeend', `<style id="ex-css">${CSS}</style>`);
  host.innerHTML = `<div class="ex"><div class="ex-stage">${HTML}</div><button class="ex-play"><div><span>▶</span>播放 30 秒说明</div></button></div>`;
  const root = host.querySelector('.ex'), stage = root.querySelector('.ex-stage'), btn = root.querySelector('.ex-play');
  const $ = id => stage.querySelector('#' + id);
  const layers = [...stage.querySelectorAll('[data-s]')];
  const lamps = $('exLamps'), glow = $('exGlow');
  for (let i = 0; i < 4; i++) {
    lamps.insertAdjacentHTML('beforeend', `<div class="ex-l" style="position:relative;padding-left:40px">📦 光束灯 0${i + 1} <span class="ex-dim" style="font-size:20px">${i ? '（复制）' : '（一个组）'}</span></div>`);
    glow.insertAdjacentHTML('beforeend', '<div style="width:46px;height:46px;border-radius:50%;background:#2a2e38"></div>');
  }
  const fit = () => stage.style.transform = `scale(${root.clientWidth / W})`;
  new ResizeObserver(fit).observe(root);
  fit();

  function render(t) {
    const cur = SCENES.find(s => t >= s.a && t < s.b) || SCENES[SCENES.length - 1];
    layers.forEach(l => { const s = SCENES[+l.dataset.s]; l.style.opacity = vis(t, s.a, s.b); });
    const cap = $('exCap');
    cap.style.opacity = cur.cap ? vis(t, cur.a + .3, cur.b) : 0;
    if (cur.cap) cap.innerHTML = `<span class="ex-num">${cur.n}</span>${cur.cap}`;
    $('exBar').style.width = `${clamp(t / LEN) * 100}%`;

    // ① 打勾前屏幕是白的，打勾后出现画面
    const on1 = t > 6.2;
    $('exChk1').textContent = on1 ? '✓' : '';
    $('exChk1').style.borderColor = on1 ? '#46d39a' : '#8e94a4';
    const k = prog(t, 6.2, 7);
    $('exScr').style.background = `linear-gradient(135deg, rgba(123,140,255,${k}), rgba(176,124,255,${k})), #f4f4f4`;
    $('exScrTxt').innerHTML = on1 ? '<span class="ex-ok">✓ 画面正常</span>' : '<span class="ex-bad">✗ 没勾：屏幕是白的</span>';

    // ② 单位不对，人像蚂蚁；改成厘米后正常
    const ok2 = t > 12.4, s2 = .12 + .88 * prog(t, 12.4, 13.4);
    $('exMan').style.transform = `scale(${s2})`;
    $('exUnit').innerHTML = ok2 ? '厘米 ✓' : '<span class="ex-bad">英寸 ✗</span>';
    $('exManTxt').innerHTML = ok2 ? '<span class="ex-ok">✓ 1.75 米的人，比例正常</span>' : '<span class="ex-bad">✗ 单位不对：人像蚂蚁</span>';

    // ③ 灯一台台复制出来，灯光面板出现这个组
    const n3 = Math.min(4, Math.max(0, Math.floor((t - 15.6) / .55) + 1));
    [...lamps.children].forEach((d, i) => { d.style.opacity = i < n3 ? 1 : 0; });
    [...glow.children].forEach((d, i) => { const lit = i < n3; d.style.background = lit ? '#fff3d6' : '#2a2e38'; d.style.boxShadow = lit ? '0 0 30px 10px rgba(255,226,170,.6)' : 'none'; });
    $('exSw').style.opacity = prog(t, 18, 18.6);
    $('exSwN').textContent = `${n3 * 6} 台 光束灯`;

    // ④ 播放头从第 0 帧走到最后一帧，升降台跟着升起来
    const p4 = prog(t, 22.2, 25.4);
    $('exHead').style.left = `${54 + p4 * 950}px`;
    $('exLift').style.bottom = `${p4 * 220}px`;
    $('exLiftTxt').style.bottom = `${p4 * 220 - 4}px`;
    $('exLiftTxt').textContent = `升降台 ${(p4 * 2.5).toFixed(1)} m`;

    // 结尾：箭头一步步亮起
    $('exFbx').style.borderColor = t > 27.4 ? '#ffd28a' : '';
    $('exHtml').style.opacity = .3 + .7 * prog(t, 28, 28.6);
  }

  let start = 0, raf = 0;
  const frame = now => {
    const t = (now - start) / 1000;
    render(Math.min(t, LEN));
    if (t < LEN) raf = requestAnimationFrame(frame);
    else { btn.hidden = false; btn.innerHTML = '<div><span>↻</span>再看一遍</div>'; }
  };
  const play = () => { cancelAnimationFrame(raf); btn.hidden = true; start = performance.now(); raf = requestAnimationFrame(frame); };
  btn.onclick = play;
  render(0);
  return { play, render, stop: () => cancelAnimationFrame(raf), length: LEN };
}
