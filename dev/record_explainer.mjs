// 开发工具：把 30 秒说明动画逐帧截图（生成器加 #explainer 打开），再用 ffmpeg 合成视频。
// 用法：node dev/record_explainer.mjs file:///…/dist/舞美生成器.html 帧目录 0:29.9667:0.033333333 1280
//      ffmpeg -framerate 30 -i 帧目录/f%04d.png -vf "scale=1280:720,format=yuv420p" -c:v libx264 -crf 20 30秒说明.mp4
// 没有 ffmpeg 时：pip install --target 某目录 imageio-ffmpeg，它自带一个 ffmpeg 程序。
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
const [url, out, times, width = '1280'] = process.argv.slice(2);
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--remote-debugging-port=9339', `--user-data-dir=${out}/p`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let list; for (let i = 0; i < 50; i++) { try { list = await (await fetch('http://127.0.0.1:9339/json/list')).json(); if (list.length) break; } catch {} await sleep(200); }
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(), errs = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) pend.get(m.id)?.(m.result ?? m); if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description?.slice(0, 300)); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result?.value;
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +width + 120, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: url + '#explainer' }); await sleep(1500);
await ev(`document.querySelector('.ex-play').hidden = true; document.getElementById('explain').style.maxWidth = '${+width + 40}px'; 1`);
await sleep(300);
const r = await ev(`JSON.stringify(document.querySelector('.ex').getBoundingClientRect())`), box = JSON.parse(r);
const ts = times.includes(':') ? (([a, b, step]) => { const o = []; for (let t = a; t <= b + 1e-9; t += step) o.push(+t.toFixed(4)); return o; })(times.split(':').map(Number)) : times.split(',').map(Number);
for (const [i, t] of ts.entries()) {
  await ev(`EXPLAINER.render(${t}); 1`);
  const shot = await send('Page.captureScreenshot', { clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 } });
  writeFileSync(`${out}/f${String(i).padStart(4, '0')}.png`, Buffer.from(shot.data, 'base64'));
}
console.log('帧数', ts.length, '尺寸', Math.round(box.width), 'x', Math.round(box.height), '报错', errs.length ? errs : '无');
chrome.kill(); process.exit(0);
