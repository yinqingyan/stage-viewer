// 页面刚打开、脚本还没改动任何东西时的整页副本，「保存为新文件」用它拼出新的 html。
// 要在 main.js 里第一个 import：其他模块和 main.js 本身都会往页面里加东西、翻译文字。
// 克隆不复制大字符串（模型数据和脚本的文字是共享的），几乎不占内存。
export const pristine = document.documentElement.cloneNode(true);
