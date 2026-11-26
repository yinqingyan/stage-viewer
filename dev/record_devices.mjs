// 开发工具：把生成好的查看器网页按「电脑」或「手机」尺寸录成一串帧，给演示视频里的电脑、手机画面用。
// 用法：node dev/record_devices.mjs 生成的.html 帧目录 desktop|phone 秒数
// 录之前先（不录）打开光束、把机械升到终点；录的时候慢慢拖动转视角（手机用触摸）。查看器用假时钟，每帧 40 毫秒。
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const [html, out, mode = 'desktop', secs = '11'] = process.argv.slice(2);
const phone = mode === 'phone', FPS = 25, DT = 1000 / FPS;
const W = phone ? 390 : 1280, H = phone ? 844 : 800;
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const port = phone ? 9347 : 9346;
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${resolve(out)}/p`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let list; for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.length) break; } catch {} await sleep(200); }
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(), errs = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) pend.get(m.id)?.(m.result ?? m); if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description?.slice(0, 300)); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result?.value;
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: phone ? 2 : 1, mobile: phone });
if (phone) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  let now = 1000; const cbs = [], t0 = Date.now();
  performance.now = () => now; Date.now = () => t0 + now;
  window.requestAnimationFrame = cb => (cbs.push(cb), cbs.length);
  window.cancelAnimationFrame = () => {};
  window.__step = dt => { now += dt; cbs.splice(0).forEach(cb => { try { cb(now); } catch (e) { console.error(e); } }); };
})();` });
await send('Page.navigate', { url: 'file://' + resolve(html) }); await sleep(1500);
const step = (n = 1) => ev(`for (let i = 0; i < ${n}; i++) __step(${DT}); 1`);
for (let t = 0; t < 600 && await ev(`!!document.getElementById('loading')`); t++) { await step(); await sleep(30); }
// 准备：光束（面光除外）全开、机械全部到终点，走完动画
await ev(`[...document.querySelectorAll('#lights button')].filter(b => b.textContent.trim() === '光束').forEach((b, i) => i !== 1 && b.click());
  [...document.querySelectorAll('#machines button')].find(b => b.textContent.includes('全部到终点'))?.click(); 1`);
for (let i = 0; i < 260; i++) { await step(); if (i % 20 === 0) await sleep(10); }
// 手机：面板收起，画面留给舞台
if (phone) await ev(`document.querySelectorAll('#side .panel').forEach(p => p.classList.add('closed')); 1`);
// 手机竖屏默认整台都放进画面，舞台偏小：先拉近一些
if (phone) for (let i = 0; i < 14; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: W / 2, y: H * .5, deltaX: 0, deltaY: -200 }); await step(3); }
await step(30);
await step(10);

let frame = 0;
const shot = async () => {
  await step();
  const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
  writeFileSync(`${out}/f${String(frame++).padStart(4, '0')}.jpg`, Buffer.from(s.data, 'base64'));
};
// 慢慢水平拖动：电脑用鼠标，手机用单指触摸
const n = Math.round(+secs * FPS), x0 = W * (phone ? .75 : .62), x1 = W * (phone ? .3 : .38), y = H * .45;
const at = k => x0 + (x1 - x0) * (k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
if (phone) await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
else await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 0; i < n; i++) {
  const x = at(i / (n - 1));
  if (phone) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  else await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
  await shot();
}
if (phone) await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
else await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y, button: 'left', buttons: 0, clickCount: 1 });
console.log(mode, '帧数', frame, '报错', errs.length ? errs : '无');
chrome.kill(); process.exit(0);
