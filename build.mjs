// 1. 查看器模板：three.js + 查看器代码全部内联成一个 html，
//    模型和配置留空（<script>/*__STAGE__*/</script>），由生成器网页或 skill 里的 build_html.py 注入。
// 2. 生成器：设计师用的单文件网页，内嵌查看器模板、型号库和模型准备说明。
// 用法：node build.mjs   → skill/stage-viewer/assets/viewer-template.html、dist/舞美生成器.html、dist/stage-viewer-skill.zip
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';

const { outputFiles } = await esbuild.build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false,
});
const app = outputFiles[0].text.replaceAll('</script', '<\\/script');
if (app.includes('/*__STAGE__*/')) throw new Error('打包后的代码里不能出现注入标记');

const html = readFileSync('src/template.html', 'utf8').replace('<script>/*__APP__*/</script>', () => `<script>${app}</script>`);
mkdirSync('skill/stage-viewer/assets', { recursive: true });
writeFileSync('skill/stage-viewer/assets/viewer-template.html', html);
console.log(`模板：skill/stage-viewer/assets/viewer-template.html（${(html.length / 1024).toFixed(0)} KB）`);

// 生成器：查看器模板作为字符串常量 VIEWER 放在生成器代码前面；'<' 转义，模板里的 </script>、<!-- 不会提前结束脚本
const gen = await esbuild.build({ entryPoints: ['src/generator.js'], bundle: true, minify: true, format: 'iife', write: false });
const genApp = gen.outputFiles[0].text.replaceAll('</script', '<\\/script');
const viewer = JSON.stringify(html).replace(/</g, '\\u003c');
// 「最近更新」弹窗：CHANGELOG.md 在 <!-- en 那行切开，上中下英；去掉大标题和网址那段（弹窗就在网站上）
const news = readFileSync('CHANGELOG.md', 'utf8').split(/^<!-- en.*$/m).map(t => t.trim().replace(/^# .*\n+.*https:\/\/\S+.*\n/, ''));
const page = readFileSync('src/generator.html', 'utf8')
  .replace('<!--__GUIDE__-->', () => markdown(readFileSync('docs/模型准备说明.md', 'utf8')))
  .replace('<!--__GUIDE_EN__-->', () => markdown(readFileSync('docs/model-guide.en.md', 'utf8')))
  .replace('<!--__NEWS__-->', () => markdown(news[0]))
  .replace('<!--__NEWS_EN__-->', () => markdown(news[1]))
  .replace('__SAKULA__', () => 'data:image/webp;base64,' + readFileSync('docs/img/sakula-peek.webp').toString('base64'))  // 页脚撒库拉小人
  .replace('__SAKULA_IDEA__', () => 'data:image/webp;base64,' + readFileSync('docs/img/sakula-idea.webp').toString('base64'))  // 生成成功
  .replace('__SAKULA_BOOM__', () => 'data:image/webp;base64,' + readFileSync('docs/img/sakula-boom.webp').toString('base64'))  // 生成失败
  .replace('<script>/*__APP__*/</script>', () => `<script>const VIEWER=${viewer};${genApp}</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/舞美生成器.html', page);
mkdirSync('dist/video', { recursive: true });
for (const l of ['zh', 'en']) copyFileSync(`docs/video/guide-${l}.mp4`, `dist/video/guide-${l}.mp4`);  // 网页上的「下载视频」
console.log(`生成器：dist/舞美生成器.html（${(page.length / 1024).toFixed(0)} KB）`);

rmSync('dist/stage-viewer-skill.zip', { force: true });
execFileSync('zip', ['-qr', '../dist/stage-viewer-skill.zip', 'stage-viewer', '-x', '*/__pycache__/*'], { cwd: 'skill' });
console.log('skill 包：dist/stage-viewer-skill.zip');

// 模型准备说明只用到标题、段落、列表（可嵌套一层）、表格、分隔线、粗体和行内代码
function markdown(md) {
  const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
  const out = [], lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    let m;
    if ((m = l.match(/^(#{1,3}) (.*)/))) out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    else if (l.trim() === '---') out.push('<hr>');
    else if (l.startsWith('|')) {
      const rows = [];
      for (; i < lines.length && lines[i].startsWith('|'); i++) if (!/^\|[\s|:-]+\|$/.test(lines[i])) rows.push(lines[i].slice(1, -1).split('|').map(c => inline(c.trim())));
      i--;
      out.push('<table><tr>' + rows[0].map(c => `<th>${c}</th>`).join('') + '</tr>' + rows.slice(1).map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('') + '</table>');
    } else if (/^(\d+\.|-) /.test(l)) {
      const tag = /^\d/.test(l) ? 'ol' : 'ul', items = [];
      for (; i < lines.length && /^(\d+\.|-) |^\s+- /.test(lines[i]); i++) {
        const sub = lines[i].match(/^\s+- (.*)/);
        if (sub) (items[items.length - 1].sub ||= []).push(inline(sub[1]));
        else items.push({ text: inline(lines[i].replace(/^(\d+\.|-) /, '')) });
      }
      i--;
      out.push(`<${tag}>` + items.map(it => `<li>${it.text}${it.sub ? '<ul>' + it.sub.map(x => `<li>${x}</li>`).join('') + '</ul>' : ''}</li>`).join('') + `</${tag}>`);
    } else out.push(`<p>${inline(l)}</p>`);
  }
  return out.join('\n');
}
