// 开发工具：录一段 1 分钟以内的演示视频：模型拖进生成器 → 认出灯具座椅 → 生成 html → 打开后转视角、开光束、升降屏、人物走动。
// 用法：node dev/record_demo.mjs dist/舞美生成器.html 测试模型/演示舞台.fbx 帧目录 [zh|en]
//      ffmpeg -framerate 25 -i 帧目录/f%04d.jpg -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -movflags +faststart 演示.mp4
// 片头、转场黑场、片尾压黑都已画在帧里，ffmpeg 不用再加 fade。
// 模型用 dev/make_demo_stage.py 生成。查看器页面换成假时钟：每帧正好走 40 毫秒再截图，渲染再慢视频也是匀速的。
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const [gen, model, out, lang = 'zh'] = process.argv.slice(2).map((a, i) => i < 3 ? resolve(a) : a);
const zh = lang === 'zh', T = (a, b) => zh ? a : b;
const W = 1280, H = 720, FPS = 25, DT = 1000 / FPS;
rmSync(out, { recursive: true, force: true }); mkdirSync(`${out}/dl`, { recursive: true });
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--remote-debugging-port=9345', `--user-data-dir=${out}/p`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let list; for (let i = 0; i < 50; i++) { try { list = await (await fetch('http://127.0.0.1:9345/json/list')).json(); if (list.length) break; } catch {} await sleep(200); }
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(), errs = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) pend.get(m.id)?.(m.result ?? m); if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description?.slice(0, 300)); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
const rect = async q => JSON.parse(await ev(`JSON.stringify(document.querySelector(${JSON.stringify(q)}).getBoundingClientRect())`));
const mid = r => [r.x + r.width / 2, r.y + r.height / 2];
await send('Runtime.enable'); await send('Page.enable');  // 不开 Page，换页时 addScriptToEvaluateOnNewDocument 不生效，假时钟装不上
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: `${out}/dl` });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

// 叠加层：章节字幕、假鼠标、点击波纹、拖动中的文件卡片、片头片尾、黑场。每次换页面重新装。
// 所有动画都由每帧的 OV.tick(dt) 或 rec 的进度推进，不用 CSS transition（截图不是实时的）
const STEPS = 8;
const OVERLAY = `(() => {
  const F = '"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif';
  const st = document.createElement('style');
  st.textContent = \`
    #ovVig { position:fixed; inset:0; z-index:2147483640; pointer-events:none; background:radial-gradient(ellipse 75% 70% at 50% 45%, transparent 60%, rgba(0,0,0,.42) 100%) }
    #ovCap { position:fixed; left:50%; top:18px; z-index:2147483646; pointer-events:none; display:flex; gap:16px; padding:11px 24px 16px 18px; border-radius:16px;
      font-family:\${F}; color:#fff; white-space:nowrap; opacity:0; transform:translateX(-50%);
      background:linear-gradient(180deg, rgba(26,28,44,.8), rgba(9,10,16,.84)); backdrop-filter:blur(18px) saturate(1.5); -webkit-backdrop-filter:blur(18px) saturate(1.5);
      border:1px solid rgba(255,255,255,.13); box-shadow:inset 0 1px 0 rgba(255,255,255,.1), 0 16px 44px rgba(0,0,0,.55) }
    #ovCap .n { display:flex; flex-direction:column; justify-content:center; align-items:center; padding-right:16px; border-right:1px solid rgba(255,255,255,.12) }
    #ovCap .n b { font:700 28px/1 \${F}; color:#ffc56b; font-variant-numeric:tabular-nums }
    #ovCap .n s { text-decoration:none; font:500 10px/1 \${F}; color:rgba(255,255,255,.38); margin-top:6px; letter-spacing:.16em }
    #ovCap .t { display:flex; flex-direction:column; justify-content:center }
    #ovCap .t h { font:700 21px/1.25 \${F}; letter-spacing:.01em } #ovCap .t p { margin:3px 0 0; font:400 13.5px/1.3 \${F}; color:rgba(255,255,255,.64) }
    #ovCap .bar { position:absolute; left:18px; right:24px; bottom:7px; height:2px; display:flex; gap:3px }
    #ovCap .bar i { flex:1; border-radius:2px; background:rgba(255,255,255,.14) } #ovCap .bar i.on { background:linear-gradient(90deg,#ffc56b,#ff9f55) }
    #ovCur { position:fixed; left:0; top:0; z-index:2147483647; pointer-events:none; width:28px; height:28px; filter:drop-shadow(0 2px 3px rgba(0,0,0,.65)) }
    .ovRip, .ovRip2 { position:fixed; z-index:2147483646; pointer-events:none; width:20px; height:20px; margin:-10px 0 0 -10px; border-radius:50% }
    .ovRip { border:2px solid #ffc56b; box-shadow:0 0 14px rgba(255,197,107,.65) } .ovRip2 { background:radial-gradient(circle, rgba(255,197,107,.6), transparent 70%) }
    #ovCard { position:fixed; z-index:2147483645; pointer-events:none; display:flex; align-items:center; gap:12px; padding:10px 18px 10px 12px; border-radius:14px; transform:rotate(-4deg);
      background:linear-gradient(135deg, rgba(42,46,74,.97), rgba(20,22,36,.97)); border:1px solid rgba(130,142,255,.75); color:#fff; font-family:\${F};
      box-shadow:0 0 0 4px rgba(91,108,255,.18), 0 18px 40px rgba(0,0,0,.55) }
    #ovCard i { font-style:normal; display:grid; place-items:center; width:38px; height:38px; border-radius:10px; background:linear-gradient(135deg,#5b6cff,#8b5cf6); font:800 11px/1 \${F}; letter-spacing:.06em }
    #ovCard b { display:block; font:600 15px/1.2 \${F} } #ovCard s { text-decoration:none; display:block; margin-top:2px; font:400 12px/1.2 \${F}; color:rgba(255,255,255,.55) }
    .ovScr { position:fixed; inset:0; z-index:2147483644; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; overflow:hidden;
      font-family:\${F}; color:#fff; background:radial-gradient(ellipse 70% 60% at 50% 42%, #1a1d3a 0%, #0a0b12 70%) }
    .ovScr:before { content:''; position:absolute; inset:0; background-image:linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px);
      background-size:48px 48px; background-position:center; -webkit-mask-image:radial-gradient(ellipse 55% 55% at 50% 50%, #000 10%, transparent 100%) }
    .ovScr .g { position:absolute; width:1100px; height:1100px; border-radius:50% }
    .ovScr .g1 { left:-420px; top:-560px; background:radial-gradient(circle, rgba(91,108,255,.34), rgba(91,108,255,0) 62%) }
    .ovScr .g2 { right:-480px; bottom:-620px; background:radial-gradient(circle, rgba(255,197,107,.16), rgba(255,197,107,0) 62%) }
    .ovScr > [data-d] { position:relative; opacity:0 }
    .ovScr .e { font:600 13px/1 \${F}; letter-spacing:.34em; color:#ffc56b; text-transform:uppercase }
    .ovScr .e:before { content:''; display:inline-block; width:6px; height:6px; border-radius:50%; background:#ffc56b; margin:0 12px 2px 0; box-shadow:0 0 10px #ffc56b }
    .ovScr h1 { font:800 58px/1.15 \${F}; margin:20px 0 0; letter-spacing:.01em }
    .ovScr p { font:400 22px/1.4 \${F}; margin:16px 0 0; color:rgba(255,255,255,.7) }
    .ovScr .u { margin-top:36px; padding:13px 28px; border-radius:999px; border:1px solid rgba(255,197,107,.5); background:rgba(255,197,107,.08); font:600 21px/1 \${F}; color:#ffe3b3; letter-spacing:.02em }
    .ovScr .tag { margin-top:16px; font:500 13px/1 \${F}; color:rgba(255,255,255,.5); letter-spacing:.2em }
    #ovFade { position:fixed; inset:0; z-index:2147483647; pointer-events:none; background:#000; opacity:0 }\`;
  document.head.append(st);
  const el = (tag, id, html) => Object.assign(document.createElement(tag), { id, innerHTML: html || '' });
  const cap = el('div', 'ovCap'), fade = el('div', 'ovFade'), vig = el('div', 'ovVig');
  const cur = el('div', 'ovCur', '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 3l14.5 10.6-6.2 1 3.4 7-2.9 1.4-3.4-7L5 20.6z" fill="#fff" stroke="#15161f" stroke-width="1.3" stroke-linejoin="round"/></svg>');
  document.body.append(vig, cap, cur, fade);
  const ease = t => t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2, cl = t => Math.max(0, Math.min(1, t));
  let capT = 0, capPhase = '', capNext = null, cx = 0, cy = 0, curS = 1;
  const setCur = () => cur.style.transform = 'translate(' + (cx - 5) + 'px,' + (cy - 3) + 'px) scale(' + curS + ')';
  // 全屏片头/片尾：k 0→1，子元素按 data-d 延迟依次浮现；mode=in 时末尾淡出露出页面，mode=out 时开头从页面淡入、末尾压黑
  const screen = (mode, html) => { const s = el('div', 'ovScr', '<div class="g g1"></div><div class="g g2"></div>' + html); s.className = 'ovScr'; s.dataset.mode = mode; cur.style.display = 'none'; cap.style.opacity = 0; capPhase = ''; capNext = null; document.body.append(s); return s; };
  window.OV = {
    tick(dt) {  // 每帧推进字幕的出入场
      capT += dt;
      if (capPhase === 'out') { const k = cl(capT / 160); cap.style.opacity = 1 - k; cap.style.transform = 'translate(-50%,' + (-k * 10) + 'px)';
        if (k >= 1) { if (capNext) { cap.innerHTML = capNext; capNext = null; capPhase = 'in'; capT = 0; } else capPhase = ''; } }
      if (capPhase === 'in') { const k = ease(cl(capT / 320)); cap.style.opacity = k; cap.style.transform = 'translate(-50%,' + ((1 - k) * -16) + 'px) scale(' + (.96 + .04 * k) + ')'; if (k >= 1) capPhase = ''; }
    },
    cap(n, h, p) {  // 第 n 步（1 起）、标题、副标题；n 为 0 表示收起
      const html = n ? '<div class="n"><b>' + String(n).padStart(2, '0') + '</b><s>/ 0' + ${STEPS} + '</s></div><div class="t"><h>' + h + '</h><p>' + p + '</p></div><div class="bar">' +
        Array.from({ length: ${STEPS} }, (_, i) => '<i' + (i < n ? ' class="on"' : '') + '></i>').join('') + '</div>' : null;
      if (capPhase === '' && cap.style.opacity != 1) { if (!html) return; cap.innerHTML = html; capPhase = 'in'; capT = 0; } else { capNext = html; capPhase = 'out'; capT = 0; }
    },
    cur(x, y) { cx = x; cy = y; setCur(); },
    rip(x, y, k) {  // k: 0→1 波纹进度；鼠标同时按一下
      let r = document.querySelector('.ovRip'), d = document.querySelector('.ovRip2');
      if (!r) { r = el('div', ''); r.className = 'ovRip'; d = el('div', ''); d.className = 'ovRip2'; document.body.append(d, r); }
      curS = k < .3 ? .86 : 1; setCur();
      if (k >= 1) return r.remove(), d.remove();
      Object.assign(r.style, { left: x + 'px', top: y + 'px', transform: 'scale(' + (1 + k * 3) + ')', opacity: 1 - k });
      Object.assign(d.style, { left: x + 'px', top: y + 'px', transform: 'scale(' + (1 + k * 1.5) + ')', opacity: (1 - k) ** 1.5 });
    },
    card(x, y, show) {
      let c = document.getElementById('ovCard');
      if (!show) return c?.remove();
      if (!c) { c = el('div', 'ovCard', '<i>FBX</i><div><b>' + ${JSON.stringify(T('演示舞台.fbx', 'demo-stage.fbx'))} + '</b><s>' + ${JSON.stringify(T('3D 模型 · 本地文件', '3D model · local file'))} + '</s></div>'); document.body.append(c); }
      Object.assign(c.style, { left: (x + 16) + 'px', top: (y + 18) + 'px' });
    },
    intro(e, h, p) { screen('in', '<div class="e" data-d="0">' + e + '</div><h1 data-d=".1">' + h + '</h1><p data-d=".22">' + p + '</p>'); },
    end(e, h, p, u, tag) { screen('out', '<div class="e" data-d=".1">' + e + '</div><h1 data-d=".18">' + h + '</h1><p data-d=".3">' + p + '</p><div class="u" data-d=".42">' + u + '</div><div class="tag" data-d=".52">' + tag + '</div>'); },
    scr(k) {  // 片头/片尾进度
      const s = document.querySelector('.ovScr'); if (!s) return; const out = s.dataset.mode === 'out';
      for (const c of s.querySelectorAll('[data-d]')) { const j = ease(cl((k - +c.dataset.d) / .3)); c.style.opacity = j; c.style.transform = 'translateY(' + ((1 - j) * 22) + 'px)'; }
      s.style.opacity = out ? cl(k / .14) : 1 - ease(cl((k - .8) / .2));
      s.style.transform = out ? '' : 'scale(' + (1 + .04 * ease(cl((k - .8) / .2))) + ')';
      fade.style.opacity = out ? ease(cl((k - .9) / .1)) : 0;
      if (!out && k >= 1) { s.remove(); cur.style.display = ''; }
    },
    fade(k) { fade.style.opacity = k; },
  };
})(); 1`;

// 假时钟：查看器页面的 requestAnimationFrame 和 performance.now 由录像脚本推进
const FAKE_CLOCK = `(() => {
  let now = 1000; const cbs = [], t0 = Date.now();
  performance.now = () => now; Date.now = () => t0 + now;
  window.requestAnimationFrame = cb => (cbs.push(cb), cbs.length);
  window.cancelAnimationFrame = () => {};
  window.__step = dt => { now += dt; cbs.splice(0).forEach(cb => { try { cb(now); } catch (e) { console.error(e); } }); };
})();`;

let frame = 0, fake = false, cx = 640, cy = 560, down = false;
const cap = async () => {
  await ev(`${fake ? `__step(${DT});` : ''} window.OV && OV.tick(${DT}); 1`);
  const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
  writeFileSync(`${out}/f${String(frame++).padStart(4, '0')}.jpg`, Buffer.from(s.data, 'base64'));
};
const ease = t => t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
// 录 sec 秒，每帧先调 f(进度 0→1)
const rec = async (sec, f) => { const n = Math.round(sec * FPS); for (let i = 0; i < n; i++) { await f?.(n > 1 ? i / (n - 1) : 1); await cap(); } };
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: down || type !== 'mouseMoved' ? 'left' : 'none', buttons: down ? 1 : 0, clickCount: 1, ...extra });
// 第 n 步字幕（标题 + 副标题），入场动画由 OV.tick 在接下来的帧里推进，不占编排时间
const caption = (n, h, p) => ev(`OV.cap(${n}, ${JSON.stringify(h)}, ${JSON.stringify(p)}); 1`);
const fade = (to, sec = .35) => rec(sec, k => ev(`OV.fade(${to ? k : 1 - k}); 1`));
// 鼠标从当前位置移到 (x, y)，用时 sec；down 时就是拖动
const move = (x, y, sec, after) => { const x0 = cx, y0 = cy; return rec(sec, async k => {
  cx = x0 + (x - x0) * ease(k); cy = y0 + (y - y0) * ease(k);
  await mouse('mouseMoved', cx, cy); await ev(`OV.cur(${cx}, ${cy}); 1`); await after?.(k);
}); };
const press = async () => { down = true; await mouse('mousePressed', cx, cy); };
const release = async () => { await mouse('mouseReleased', cx, cy); down = false; };
const click = async () => { await press(); await release(); await rec(.4, k => ev(`OV.rip(${cx}, ${cy}, ${k}); 1`)); };
const key = (type, code, k) => send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) });

// ---------- 1 生成器 ----------
await send('Page.navigate', { url: `file://${gen}?lang=${lang}` }); await sleep(2000);
await ev(OVERLAY); await ev(`document.documentElement.style.scrollBehavior = 'auto'; 1`);
await ev(`OV.cur(${cx}, ${cy}); 1`);
// 片头
await ev(`OV.intro('Stage Viewer · ${T('免费开源', 'free &amp; open source')}', ${JSON.stringify(T('把任何 3D 模型，变成一个网页', 'Turn any 3D model into one web page'))}, ${JSON.stringify(T('拖进生成器 · 双击就能看 · 模型不上传', 'Drop it in · double-click to open · nothing uploaded'))}); 1`);
await rec(2.4, k => ev(`OV.scr(${k}); 1`));
await caption(1, T('拖进生成器', 'Drop it in'), T('把 3D 文件（FBX）拖到页面上，文件不上传', 'Drag a 3D file (FBX) onto the page, nothing is uploaded'));
await rec(1);
const [dx, dy] = mid(await rect('#drop'));
await ev(`OV.card(${cx}, ${cy}, true); 1`);
await move(dx, dy, 1.6, () => ev(`OV.card(${cx}, ${cy}, true); 1`));
await ev(`OV.card(0, 0, false); 1`);
const { root } = await send('DOM.getDocument'); const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file' });
await send('DOM.setFileInputFiles', { nodeId, files: [model] });
await rec(.4, k => ev(`OV.rip(${cx}, ${cy}, ${k}); 1`));
for (let t = 0; t < 400 && await ev('document.getElementById("s3").classList.contains("off")'); t++) await cap();
await rec(1);

const scrollTo = async (q, sec, off = 16) => {
  const y0 = await ev('scrollY'), y1 = await ev(`Math.min(document.querySelector(${JSON.stringify(q)}).getBoundingClientRect().top + scrollY - ${off}, document.documentElement.scrollHeight - innerHeight)`);
  await rec(sec, k => ev(`scrollTo(0, ${y0 + (y1 - y0) * ease(k)}); 1`));
};
await caption(2, T('自动识别', 'Auto-detected'), T('灯具、座椅都认出来了，用途已经填好', 'Lights and seats recognised, roles filled in'));
await move(900, 600, .1);
await scrollTo('#s2', 1.2, 80);
await rec(2.6);
await caption(3, T('一键生成', 'Generate'), T('点生成，得到一个离线 html 文件', 'One click, one offline html file'));
await scrollTo('#s3', 1);
await rec(.5);
const [gx, gy] = mid(await rect('#go'));
await move(gx, gy, 1);
await click();
for (let t = 0; t < 600 && !readdirSync(`${out}/dl`).some(f => f.endsWith('.html')); t++) await cap();
await rec(1.2);
const html = readdirSync(`${out}/dl`).find(f => f.endsWith('.html'));
await caption(0); await fade(1);

// ---------- 2 生成的网页 ----------
await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_CLOCK });
await send('Page.navigate', { url: `file://${out}/dl/${encodeURIComponent(html)}` }); await sleep(1500);
fake = true;
for (let t = 0; t < 600 && await ev(`!!document.getElementById('loading')`); t++) { await ev(`__step(${DT}); 1`); await sleep(30); }
for (let i = 0; i < 40; i++) { await ev(`__step(${DT}); 1`); await sleep(20); }  // 等贴图、星光都出来
await ev(OVERLAY); cx = 640; cy = 420; await ev(`OV.cur(${cx}, ${cy}); OV.fade(1); 1`);
await fade(0);
await caption(4, T('双击打开', 'Double-click'), T('一个能互动的三维舞台，浏览器里直接看', 'An interactive 3D stage, right in the browser'));
await rec(1.6);
// 拖动转视角、滚轮拉近
await move(600, 420, .3); await press();
await move(510, 410, 2); await release();
let wheel = 0;
await rec(.6, () => wheel++ % 5 ? null : mouse('mouseWheel', cx, cy, { deltaX: 0, deltaY: -100 }));
await rec(.6);

// 灯光：打开三组光束
await caption(5, T('灯光光束', 'Light beams'), T('灯光分组开关，光束一键打开', 'Lights in groups, beams one click away'));
const beamBtns = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#lights button')].filter(b => b.textContent.trim() === ${JSON.stringify(T('光束', 'Beam'))}).map(b => { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }))`));
// 面光是染色灯，光束太宽会糊住画面，只开天排和地排
for (const [bx, by] of beamBtns.filter((_, i) => i !== 1)) { await move(bx, by, .7); await click(); await rec(.3); }
await rec(1.2);

// 机械：拖一个滑块，再「全部到终点」
await caption(6, T('机械升降', 'Machinery'), T('升降屏、升降台：拖滑块就动', 'Lifting screens and lifts: drag a slider'));
const sl = await rect('#machines input[type=range]');
await move(sl.x + 7, sl.y + sl.height / 2, .8); await press();
await move(sl.x + sl.width - 7, sl.y + sl.height / 2, 2.4); await release();
await rec(.4);
const allEnd = JSON.parse(await ev(`JSON.stringify((b => { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })([...document.querySelectorAll('#machines button')].find(b => b.textContent.includes(${JSON.stringify(T('全部到终点', 'All to end'))}))))`));
await move(...allEnd, .7); await click();
await rec(3);

// 换视角
await caption(7, T('预设视角', 'Preset views'), T('正面、45°、平面，一键切换', 'Front, 45°, plan: one click'));
const v45 = JSON.parse(await ev(`JSON.stringify((b => { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })([...document.querySelectorAll('#views button')][1]))`));
await move(...v45, .8); await click();
await rec(2.3);

// 人物走动
await caption(8, T('人物走动', 'Walk mode'), T('第一人称走进去，像在现场一样看', 'Explore it in first person, as if on site'));
const [wx, wy] = mid(await rect('#walk'));
await move(wx, wy, .7); await click();
await rec(1);
await move(640, 380, .5);
await key('keyDown', 'KeyW', 'w');
await rec(1.6);
await key('keyUp', 'KeyW', 'w');
await press(); await move(520, 360, 1.6); await release();
await rec(1);

// 片尾：从画面淡入，最后压黑
await caption(0);
await ev(`OV.cur(-100, -100); OV.end('Stage Viewer', ${JSON.stringify(T('任何 3D 模型 → 一个 html', 'Any 3D model → one html file'))}, ${JSON.stringify(T('双击就能看 · 发给谁都能打开 · 模型不上传', 'Double-click to open · share with anyone · never uploaded'))}, 'yinqingyan.github.io/stage-viewer', ${JSON.stringify(T('免费开源 · FREE &amp; OPEN SOURCE', 'FREE &amp; OPEN SOURCE'))}); 1`);
await rec(3.4, k => ev(`OV.scr(${k}); 1`));
console.log('帧数', frame, '时长', (frame / FPS).toFixed(1), '秒', '报错', errs.length ? errs : '无');
chrome.kill(); process.exit(0);
