// Throwaway: build the second WeChat paste probe from REAL MathJax output.
//
// The first probe's SVG was hand-built and its viewBox did not match its path
// coordinates, so the glyph was drawn entirely outside the visible area. It was
// blank in every browser, not just in WeChat - which made the result meaningless.
// This version emits three variants of a genuine formula so the factors are
// separated, and the caller must confirm they render in Chrome before it is
// handed over for a WeChat test.
import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js'
import fs from 'node:fs'

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)
const tex = new TeX({ packages: AllPackages })
const svg = new SVG({ fontCache: 'none' })
const doc = mathjax.document('', { InputJax: tex, OutputJax: svg })

const TEX = 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'
const raw: string = adaptor.outerHTML(doc.convert(TEX, { display: true }) as never)

// Strip MathJax's custom element wrapper; WeChat has no CSS for it and it is not
// in our allowed vocabulary either.
const bare = raw.replace(/<mjx-container[^>]*>/g, '').replace(/<\/mjx-container>/g, '')

const INK = '#1F2937'

/** Variant A: exactly what MathJax emits - `ex` units on the attributes, currentColor. */
const variantA = bare

/** Variant B: explicit ink colour, `ex` units left on the attributes. */
const variantB = bare.replace(/currentColor/g, INK)

/**
 * Variant C: explicit colour, and the intrinsic size moved into `style` as
 * absolute px. `ex` resolves against the surrounding font-size, which WeChat's
 * paste target controls and we do not; px does not depend on it.
 */
const variantC = (() => {
  const widthEx = Number(bare.match(/width="([\d.]+)ex"/)?.[1] ?? 0)
  const heightEx = Number(bare.match(/height="([\d.]+)ex"/)?.[1] ?? 0)
  const valign = bare.match(/vertical-align:\s*(-?[\d.]+)ex/)?.[1] ?? '0'
  // 1ex is about half the font size; the article body is 15px.
  const px = (ex: number) => Math.round(ex * 7.8)
  return bare
    .replace(/currentColor/g, INK)
    .replace(/\swidth="[\d.]+ex"/, '')
    .replace(/\sheight="[\d.]+ex"/, '')
    .replace(
      /style="vertical-align:[^"]*"/,
      `style="width:${px(widthEx)}px;height:${px(heightEx)}px;max-width:100%;vertical-align:${Math.round(Number(valign) * 7.8)}px;"`,
    )
})()

const FORBIDDEN =
  /\s(class|id)=|<script|<style|<div|<foreignObject|<defs|<use\b|position:\s*(fixed|absolute|sticky)|display:\s*grid|@media|@keyframes/gi

const VARIANTS: { key: string; title: string; what: string; html: string }[] = [
  {
    key: 'A',
    title: '变体 A · MathJax 原样输出（ex 单位 + currentColor）',
    what: '这是最接近上一轮空白探针的写法。如果 A 空白而 B/C 正常，问题就出在 ex 单位或 currentColor。',
    html: variantA,
  },
  {
    key: 'B',
    title: '变体 B · 换成显式墨色，尺寸仍是 ex 属性',
    what: '只改了颜色。和 A 对比就能判断 currentColor 是不是元凶。',
    html: variantB,
  },
  {
    key: 'C',
    title: '变体 C · 显式墨色 + 尺寸改成 px 写进 style（推荐做法）',
    what: '这是 doocs 和 Wenyan 实际采用的形态。如果 C 正常，公式就走这条路。',
    html: variantC,
  },
]

const body = VARIANTS.map(
  (v) => `<section style="margin:0 0 28px;padding:16px 18px;border:1px dashed #B9DAFF;background:#F8FBFF;">
<p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#17365D;text-indent:0;"><span leaf="">公式变体 ${esc(v.title)}</span></p>
<p style="margin:0 0 12px;font-size:12px;color:#6B7793;text-indent:0;"><span leaf="">看什么：${esc(v.what)}</span></p>
<p style="margin:0 0 8px;font-size:12px;color:#A57427;text-indent:0;font-family:Menlo,Consolas,monospace;"><span leaf="">${esc(TEX)}</span></p>
<p style="margin:0;padding:14px 0;text-align:center;text-indent:0;background:#FFFFFF;border:1px solid #E6EDF6;">${v.html}</p>
<p style="margin:8px 0 0;font-size:12px;color:#888888;text-indent:0;"><span leaf="">↑ 上面应该显示一元二次方程的求根公式。空白 = 这个写法不行。</span></p>
</section>`,
).join('\n')

const control = `<section style="margin:0 0 28px;padding:16px 18px;border:1px dashed #2BA672;background:#F3FBF7;">
<p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#1F7E58;text-indent:0;"><span leaf="">对照 D · 纯 CSS 色块（必须正常）</span></p>
<p style="margin:0 0 12px;font-size:12px;color:#6B7793;text-indent:0;"><span leaf="">看什么：这条如果不正常，说明粘贴本身出了问题，A/B/C 的结果都不能作数。</span></p>
<section style="margin:0;height:56px;background:#EAF3FF;border:2px solid #1677FF;border-radius:8px;display:flex;align-items:center;justify-content:center;"><p style="margin:0;font-size:14px;font-weight:700;color:#17365D;text-indent:0;text-align:center;"><span leaf="">CSS-BLOCK-OK</span></p></section>
</section>`

const fragment = `<section style="max-width:677px;margin:0 auto;background:#FFFFFF;color:#333333;line-height:1.75;letter-spacing:1px;padding:0 10px;box-sizing:border-box;">
<p style="margin:24px 0 8px;font-size:20px;font-weight:800;color:#1F2937;text-indent:0;"><span leaf="">公式粘贴验证 · 第二版</span></p>
<p style="margin:0 0 24px;font-size:13px;color:#6B7793;text-indent:0;"><span leaf="">三个变体是同一条求根公式，只有颜色和尺寸写法不同。告诉我哪几个显示了公式、哪几个空白。</span></p>
${body}
${control}
</section>`

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const page = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>公式粘贴验证 v2</title>
<style>
  body{margin:0;background:#E8ECF3;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;}
  .bar{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border-bottom:1px solid #d7deea;}
  .bar .hint{font-size:13px;color:#5c6a85;line-height:1.6;}
  .bar button{border:none;background:#4F6CE8;color:#fff;font-size:14px;font-weight:600;padding:10px 20px;border-radius:10px;cursor:pointer;white-space:nowrap;}
  .stage{padding:24px 16px 80px;display:flex;justify-content:center;}
  .paper{background:#fff;border-radius:6px;box-shadow:0 10px 30px -12px rgba(20,30,60,.28);width:677px;max-width:100%;}
  #result{font-size:13px;color:#1F7E58;font-weight:600;}
</style></head>
<body>
<div class="bar"><div class="hint"><strong>用法：</strong>点右边按钮 → 公众号后台新建图文 → 正文里 Ctrl+V → 告诉我 A / B / C 哪几个显示了公式。<br><span id="result"></span></div><button onclick="copyIt()">复制到公众号</button></div>
<div class="stage"><div class="paper" id="shell">
${fragment}
</div></div>
<script>
function copyIt(){
  const root=document.querySelector('#shell > section');
  const html=root.outerHTML, text=root.innerText;
  const done=(m)=>{document.getElementById('result').textContent=m;};
  const item=new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([text],{type:'text/plain'})});
  navigator.clipboard.write([item]).then(()=>done('已复制 '+html.length+' 字节')).catch(e=>done('复制失败：'+e.message));
}
</script>
</body></html>`

const out = process.argv[2] || '../粘贴验证2.html'
fs.writeFileSync(out, page, 'utf8')

console.log('wrote', out, fs.statSync(out).size, 'bytes')
console.log('formula:', TEX)
for (const v of VARIANTS) {
  const bad = v.html.match(FORBIDDEN) || []
  console.log(
    `  variant ${v.key}: ${String(v.html.length).padStart(6)}B  forbidden=${bad.length ? [...new Set(bad)].join(',') : 'NONE'}  viewBox="${v.html.match(/viewBox="([^"]+)"/)?.[1] ?? '-'}"`,
  )
}
