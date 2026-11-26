// 开发工具：录演示视频的「发给客户」一章（约 15 秒）：聊天窗口里发出 html 文件、客户回复 → 电脑和手机的样机里同时播放查看器录好的帧。
// 用法：node dev/record_share.mjs 电脑帧目录 手机帧目录 输出目录 [zh|en]
//      电脑/手机帧由 dev/record_devices.mjs 录（1280×800 和 390×844@2x）。输出 f%04d.jpg，1280×720，25 fps，375 帧。
// 视觉语言和 record_demo.mjs 的叠加层一致（玻璃卡片、金色点缀、Noto Sans CJK）。所有动画都由帧号算出来，没有 CSS transition。
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const [deskDir, phoneDir, out, lang = 'zh'] = process.argv.slice(2).map((a, i) => i < 3 ? resolve(a) : a);
const zh = lang === 'zh', T = (a, b) => zh ? a : b;
const W = 1280, H = 720, FPS = 25, N = 15 * FPS, PORT = 9348;
const frames = d => readdirSync(d).filter(f => /^f\d+\.jpg$/.test(f)).sort().map(f => `file://${d}/${f}`);
const DESK = frames(deskDir), PHONE = frames(phoneDir);
if (!DESK.length || !PHONE.length) throw new Error('帧目录是空的');
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });

// 场景页面：一张背景、聊天卡片（0–4 s）、电脑 + 手机样机（4–15 s）。window.setFrame(i) 把第 i 帧的状态摆好
const F = '"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif';
const SCENE = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
  html, body { margin:0; width:${W}px; height:${H}px; overflow:hidden; font-family:${F}; color:#fff; -webkit-font-smoothing:antialiased }
  body { position:relative; background:radial-gradient(ellipse 70% 60% at 50% 42%, #1a1d3a 0%, #0a0b12 70%) }
  body:before { content:''; position:absolute; inset:0; background-image:linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px);
    background-size:48px 48px; background-position:center; -webkit-mask-image:radial-gradient(ellipse 55% 55% at 50% 50%, #000 10%, transparent 100%) }
  .g { position:absolute; width:1100px; height:1100px; border-radius:50% }
  .g1 { left:-420px; top:-560px; background:radial-gradient(circle, rgba(91,108,255,.34), rgba(91,108,255,0) 62%) }
  .g2 { right:-480px; bottom:-620px; background:radial-gradient(circle, rgba(255,197,107,.16), rgba(255,197,107,0) 62%) }
  .glass { background:linear-gradient(180deg, rgba(26,28,44,.8), rgba(9,10,16,.84)); border:1px solid rgba(255,255,255,.13); box-shadow:inset 0 1px 0 rgba(255,255,255,.1), 0 16px 44px rgba(0,0,0,.55) }
  .cap { position:absolute; left:50%; top:18px; transform:translateX(-50%); display:flex; align-items:center; gap:16px; padding:12px 26px 13px 20px; border-radius:16px; white-space:nowrap; opacity:0 }
  .cap:before { content:''; width:4px; align-self:stretch; border-radius:2px; background:linear-gradient(180deg,#ffc56b,#ff9f55) }
  .cap h { display:block; font:700 22px/1.25 ${F}; letter-spacing:.01em } .cap p { margin:3px 0 0; font:400 13.5px/1.3 ${F}; color:rgba(255,255,255,.64) }
  /* 聊天窗口：中性样式，不模仿任何现成软件 */
  #chat { position:absolute; left:50%; top:52%; width:560px; transform:translate(-50%,-50%); border-radius:20px; overflow:hidden; opacity:0 }
  #chat .hd { display:flex; align-items:center; gap:12px; padding:14px 20px; border-bottom:1px solid rgba(255,255,255,.08) }
  #chat .av { width:36px; height:36px; border-radius:50%; display:grid; place-items:center; font:700 15px/1 ${F}; background:linear-gradient(135deg,#5b6cff,#8b5cf6) }
  #chat .hd b { font:600 15px/1.2 ${F} } #chat .hd s { text-decoration:none; display:block; margin-top:2px; font:400 11.5px/1 ${F}; color:rgba(255,255,255,.45) }
  #chat .hd s:before { content:''; display:inline-block; width:6px; height:6px; border-radius:50%; background:#4ade80; margin:0 5px 1px 0 }
  #chat .bd { position:relative; padding:22px 20px 24px; display:flex; flex-direction:column; gap:14px; min-height:200px }
  #mTyp { position:absolute; left:20px; bottom:24px }  /* 「正在输入」和回复占同一个位置 */
  .msg { display:flex; align-items:flex-end; gap:10px; opacity:0 } .msg.me { flex-direction:row-reverse }
  .msg .av { width:28px; height:28px; border-radius:50%; background:#2a2d44; display:grid; place-items:center; font:700 12px/1 ${F} }
  .bub { max-width:360px; padding:11px 15px; border-radius:16px; font:400 15px/1.45 ${F}; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.08) }
  .me .bub { background:linear-gradient(135deg, rgba(91,108,255,.42), rgba(139,92,246,.36)); border-color:rgba(130,142,255,.45) }
  .file { display:flex; align-items:center; gap:12px; padding:12px 16px 12px 12px; border-radius:14px }
  .file i { font-style:normal; display:grid; place-items:center; width:42px; height:42px; border-radius:11px; background:linear-gradient(135deg,#5b6cff,#8b5cf6); font:800 11px/1 ${F}; letter-spacing:.06em; box-shadow:0 6px 16px rgba(91,108,255,.35) }
  .file b { display:block; font:600 15px/1.2 ${F} } .file s { text-decoration:none; display:block; margin-top:3px; font:400 12px/1.2 ${F}; color:rgba(255,255,255,.55) }
  .meta { font:400 11.5px/1 ${F}; color:rgba(255,255,255,.4); padding:0 6px 2px; opacity:0; align-self:flex-end }
  .meta:before { content:'✓ '; color:#ffc56b }
  .typing { display:flex; gap:5px; padding:14px 16px } .typing i { width:7px; height:7px; border-radius:50%; background:rgba(255,255,255,.55) }
  /* 样机 */
  #devs { position:absolute; inset:0 }
  #floor { position:absolute; left:50%; top:600px; width:1000px; height:160px; transform:translateX(-50%); background:radial-gradient(ellipse 50% 50% at 50% 50%, rgba(91,108,255,.18), transparent 70%); opacity:0 }
  .lap { position:absolute; left:64px; top:132px; width:800px; opacity:0 }
  .lap .scr { width:736px; height:460px; margin:0 auto; border:12px solid #1a1b24; border-bottom-width:14px; border-radius:18px 18px 4px 4px; background:#000; overflow:hidden; box-shadow:0 0 0 1px rgba(255,255,255,.08), 0 34px 80px rgba(0,0,0,.65) }
  .lap .scr:before { content:''; position:absolute; left:50%; top:-8px; width:6px; height:6px; margin-left:-3px; border-radius:50%; background:#2b2d3a }
  .lap .base { position:relative; height:16px; border-radius:2px 2px 16px 16px; background:linear-gradient(#34364a, #1b1c26); box-shadow:0 12px 30px rgba(0,0,0,.5) }
  .lap .base:after { content:''; position:absolute; left:50%; top:0; width:120px; height:5px; margin-left:-60px; border-radius:0 0 6px 6px; background:#0f1016 }
  .ph { position:absolute; left:958px; top:122px; width:222px; height:480px; border:10px solid #1a1b24; border-radius:38px; background:#000; overflow:hidden; opacity:0;
    box-shadow:0 0 0 1px rgba(255,255,255,.1), 0 34px 80px rgba(0,0,0,.65) }
  .ph:before { content:''; position:absolute; z-index:2; left:50%; top:10px; width:72px; height:20px; margin-left:-36px; border-radius:12px; background:#0a0a0f }
  .scr img, .ph img { display:block; width:100%; height:100%; object-fit:cover }
  .lab { position:absolute; top:648px; display:flex; align-items:center; gap:8px; padding:8px 16px; border-radius:999px; font:500 14px/1 ${F}; color:rgba(255,255,255,.82); white-space:nowrap; opacity:0 }
  .lab:before { content:''; width:6px; height:6px; border-radius:50%; background:#ffc56b; box-shadow:0 0 8px #ffc56b }
  #labD { left:464px; transform:translateX(-50%) } #labP { left:1069px; transform:translateX(-50%) }
</style></head><body>
  <div class="g g1"></div><div class="g g2"></div>
  <div class="cap glass" id="capA"><div><h>${T('发给客户', 'Send it to the client')}</h><p>${T('一个 html 文件，微信、邮件都能发', 'One html file: send it by chat or email')}</p></div></div>
  <div class="cap glass" id="capB"><div><h>${T('手机、电脑，点开就能看', 'Phone or computer, it just opens')}</h><p>${T('不用装软件 · 不用登录 · 离线也能打开', 'No app to install · no login · works offline')}</p></div></div>
  <div id="chat" class="glass">
    <div class="hd"><div class="av">${T('客', 'C')}</div><div><b>${T('客户 · 李总', 'Client · Ms. Lee')}</b><s>${T('在线', 'online')}</s></div></div>
    <div class="bd">
      <div class="msg me" id="mFile"><div class="bub file"><i>HTML</i><div><b>${T('演示舞台.html', 'demo-stage.html')}</b><s>1.4 MB · ${T('网页文件', 'web page')}</s></div></div></div>
      <div class="meta" id="mSent">${T('已发送', 'Sent')}</div>
      <div class="msg" id="mTyp"><div class="av">${T('客', 'C')}</div><div class="bub typing"><i></i><i></i><i></i></div></div>
      <div class="msg" id="mRe"><div class="av">${T('客', 'C')}</div><div class="bub">${T('收到，我手机上看看', "Got it, I'll take a look on my phone")}</div></div>
    </div>
  </div>
  <div id="devs">
    <div id="floor"></div>
    <div class="lap" id="lap"><div class="scr"><img id="imgD"></div><div class="base"></div></div>
    <div class="ph" id="ph"><img id="imgP"></div>
    <div class="lab glass" id="labD">${T('电脑：双击就打开', 'Computer: double-click to open')}</div>
    <div class="lab glass" id="labP">${T('手机：点开就看', 'Phone: tap to view')}</div>
  </div>
<script>
  const DESK = ${JSON.stringify(DESK)}, PHONE = ${JSON.stringify(PHONE)}, FPS = ${FPS}, T0 = 4;  // T0：样机一段开始的秒数
  // 录好的轨道转得比这一段长，慢放：[起始帧, 每输出帧前进多少张]，正面转到 45° 左右就停。手机转得快，放得更慢
  const RD = [10, .55], RP = [8, .4];
  const $ = id => document.getElementById(id);
  const ease = t => t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2, cl = t => Math.max(0, Math.min(1, t)), seg = (t, a, b) => ease(cl((t - a) / (b - a)));
  const show = (el, k, dy = 24, s = 1) => { el.style.opacity = k; el.style.transform = (el.dataset.tf || '') + ' translateY(' + ((1 - k) * dy) + 'px) scale(' + (1 - (1 - k) * (1 - s)) + ')'; };
  for (const id of ['capA', 'capB']) $(id).dataset.tf = 'translateX(-50%)';
  $('chat').dataset.tf = 'translate(-50%,-50%)'; $('labD').dataset.tf = $('labP').dataset.tf = 'translateX(-50%)';
  const typ = $('mTyp').querySelectorAll('i');
  window.setFrame = async i => {
    const t = i / FPS;
    // 0–4 s 聊天
    show($('capA'), seg(t, .1, .5) * (1 - seg(t, 3.5, 3.75)), -16, .96);
    show($('chat'), seg(t, 0, .55) * (1 - seg(t, 3.6, 4)), 24, .96);
    const f = seg(t, .7, 1.15); $('mFile').style.opacity = f; $('mFile').style.transform = 'translate(' + ((1 - f) * 56) + 'px,' + ((1 - f) * 30) + 'px) scale(' + (.86 + .14 * f) + ')';
    $('mSent').style.opacity = seg(t, 1.25, 1.55);
    const ty = t < 2.55 ? seg(t, 1.85, 2.05) : 1 - seg(t, 2.55, 2.7); show($('mTyp'), ty, 8);
    typ.forEach((d, j) => d.style.transform = 'translateY(' + (-3.5 * Math.abs(Math.sin(t * 7 + j * 1.1))) + 'px)');
    show($('mRe'), seg(t, 2.65, 3.05), 14, .94);
    // 4–15 s 样机
    show($('capB'), seg(t, T0, T0 + .45), -16, .96);
    $('floor').style.opacity = seg(t, T0 + .2, T0 + 1.2);
    show($('lap'), seg(t, T0, T0 + .75), 44, .97);
    show($('ph'), seg(t, T0 + .2, T0 + .95), 44, .97);
    show($('labD'), seg(t, T0 + .8, T0 + 1.2), 12); show($('labP'), seg(t, T0 + .95, T0 + 1.35), 12);
    const j = Math.max(0, i - Math.round(T0 * FPS)), d = $('imgD'), p = $('imgP');
    const ds = DESK[(RD[0] + Math.floor(j * RD[1])) % DESK.length], ps = PHONE[(RP[0] + Math.floor(j * RP[1])) % PHONE.length];
    if (d.src !== ds) d.src = ds; if (p.src !== ps) p.src = ps;
    await Promise.all([d.decode().catch(() => {}), p.decode().catch(() => {})]);  // 截图前等图片解码完
    return i;
  };
</script></body></html>`;
writeFileSync(`${out}/scene.html`, SCENE);

const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${out}/p`, '--hide-scrollbars', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let list; for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.length) break; } catch {} await sleep(200); }
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(), errs = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) pend.get(m.id)?.(m.result ?? m); if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description?.slice(0, 300)); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) errs.push(r.exceptionDetails.exception?.description?.slice(0, 300)); return r.result?.value; };
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `file://${out}/scene.html` }); await sleep(800);
await ev('document.fonts.ready.then(() => 1)');
for (let i = 0; i < N; i++) {
  await ev(`setFrame(${i})`);
  const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
  writeFileSync(`${out}/f${String(i).padStart(4, '0')}.jpg`, Buffer.from(s.data, 'base64'));
}
console.log('帧数', N, '时长', (N / FPS).toFixed(1), '秒', '电脑帧', DESK.length, '手机帧', PHONE.length, '报错', errs.length ? errs : '无');
chrome.kill(); process.exit(0);
