import { describe, expect, it } from 'vitest'
import {
  classifyPaste,
  cleanHtmlSource,
  codeScore,
  detectCodeLanguage,
  extractImages,
  fillImageSlots,
  htmlToDialect,
  isAccentColor,
  isCodeOnlyHtml,
  isHighlightStyle,
  isIdeFormattedHtml,
  isImagePlaceholderText,
  isQuoteCardContent,
  looksLikeMarkdown,
  markdownScore,
  normalizeDialectMarkdown,
  shouldConvertHtml,
} from './rich-paste'
import { parseMarkdown } from './parse'

// ---------------------------------------------------------------------------
// the four gates
// ---------------------------------------------------------------------------

describe('gate 1: the plain text is already Markdown', () => {
  it('skips conversion for a Markdown clipboard', () => {
    const plain = '# 标题\n\n- 项目一\n- 项目二\n\n**粗体**正文'
    expect(looksLikeMarkdown(plain)).toBe(true)
    expect(shouldConvertHtml('<h1>标题</h1><ul><li>项目一</li></ul>', plain)).toBe(false)
    expect(classifyPaste('<h1>标题</h1>', plain)).toMatchObject({
      kind: 'already-markdown',
      convert: false,
    })
  })

  it('counts a lone fenced block as enough, but not a lone horizontal rule', () => {
    expect(markdownScore('```js\nconst a = 1\n```').score).toBe(2)
    expect(looksLikeMarkdown('```js\nconst a = 1\n```')).toBe(true)
    // `---` alone is a weak signal: prose separated by a rule is not Markdown.
    expect(markdownScore('正文\n\n---\n\n更多正文').score).toBe(1)
    expect(looksLikeMarkdown('正文\n\n---\n\n更多正文')).toBe(false)
  })

  it('recognises our own dialect markers', () => {
    expect(looksLikeMarkdown(':::center\n居中一句\n:::\n\n==重点==')).toBe(true)
    expect(looksLikeMarkdown('![配图]()')).toBe(true)
  })

  it('does not mistake a web page copy for Markdown', () => {
    // Chrome renders <ul> bullets as U+2022 in text/plain, not as `-`.
    const plain = '标题\n这是一段普通的中文正文，包含标点符号。\n• 第一\n• 第二'
    expect(markdownScore(plain).score).toBe(0)
    expect(shouldConvertHtml('<h2>标题</h2><p>这是一段普通的中文正文。</p>', plain)).toBe(true)
  })
})

describe('gate 2: HTML from a code editor', () => {
  const CODE = 'const a = 1;\nfunction f() {\n  return 2;\n}'

  it('flags a VS Code clipboard dump and reports the language', () => {
    const html =
      '<meta charset="utf-8"><div style="color:#abb2bf;background-color:#282c34;font-family: Consolas, \'Courier New\', monospace;">' +
      `<pre class="language-js">${CODE}</pre></div>`
    expect(isIdeFormattedHtml(html, CODE)).toBe(true)
    expect(classifyPaste(html, CODE)).toMatchObject({ kind: 'ide-code', convert: false, lang: 'js' })
  })

  it('flags a JetBrains dump by its monospace font stack', () => {
    const html = "<html><body><pre style=\"font-family: 'JetBrains Mono', monospace;\">int x = 1;</pre></body></html>"
    expect(isIdeFormattedHtml(html, 'int x = 1;')).toBe(true)
    expect(shouldConvertHtml(html, 'int x = 1;')).toBe(false)
  })

  it('flags Monaco token classes', () => {
    const html = '<div><span class="mtk5">const</span> <span class="mtk1">a</span> = <span class="mtk6">1</span></div>'
    expect(isIdeFormattedHtml(html, 'const a = 1')).toBe(true)
  })

  it('never flags an office/云文档 paste, even when it contains a monospace run', () => {
    // Word puts font-family:Consolas on inline code; without the veto the whole
    // document would lose its formatting.
    const html =
      '<html><head><meta charset=utf-8></head><body>' +
      '<p class=MsoNormal><span style="font-family:Consolas">code</span> 正文说明</p></body></html>'
    expect(isIdeFormattedHtml(html, 'code 正文说明')).toBe(false)
    expect(shouldConvertHtml(html, 'code 正文说明')).toBe(true)
  })

  it('does not flag an article that merely contains one long snippet', () => {
    // ~70% of the characters are code, yet the document is prose with a heading,
    // two paragraphs and a fence — it must be converted, not dumped as code.
    const html =
      '<div><h2>说明</h2><p>下面是一段示例代码。</p>' +
      '<pre><code class="language-js">const a = 1;\nconst b = 2;\nreturn a + b;</code></pre>' +
      '<p>结束。</p></div>'
    const plain = '说明\n下面是一段示例代码。\nconst a = 1;\nconst b = 2;\nreturn a + b;\n结束。'
    expect(isIdeFormattedHtml(html, plain)).toBe(false)
    expect(shouldConvertHtml(html, plain)).toBe(true)
  })
})

describe('gate 3: the body is code', () => {
  const CODE = 'function f(a, b) {\n  const c = a + b;\n  return c;\n}\n\nif (c === 3) {\n  f(1, 2);\n}'

  it('flags code-dense plain text', () => {
    expect(codeScore(CODE).score).toBeGreaterThanOrEqual(3)
    expect(classifyPaste('<div>hello</div>', CODE)).toMatchObject({ kind: 'code-block', convert: false })
  })

  it('does not flag prose', () => {
    const prose = '人工智能正加速进入产业应用。\n围绕技术成果转化，平台持续连接资源。'
    expect(codeScore(prose).score).toBe(0)
  })

  it('flags a bare pre/code dump with no prose markup', () => {
    const html = '<pre><code class="language-go">package main\n\nfunc main() {\n\tprintln(1)\n}</code></pre>'
    expect(isCodeOnlyHtml(html)).toBe(true)
    expect(classifyPaste(html, 'package main')).toMatchObject({ kind: 'code-block', lang: 'go' })
  })

  it('keeps a real document out of the code gate', () => {
    const html = '<div><h2>标题</h2><p>正文</p><pre><code>x = 1;</code></pre></div>'
    expect(isCodeOnlyHtml(html)).toBe(false)
    expect(shouldConvertHtml(html, '标题\n正文\nx = 1;')).toBe(true)
  })
})

describe('gate 4: [Image #N] placeholders', () => {
  it('rejects a clipboard that is nothing but a placeholder', () => {
    expect(isImagePlaceholderText('[Image #1]')).toBe(true)
    expect(isImagePlaceholderText('  [Image #2]  ')).toBe(true)
    expect(isImagePlaceholderText('[Image #1]\n[Image #2]')).toBe(true)
    const decision = classifyPaste('<p>x</p>', '[Image #1]')
    expect(decision).toMatchObject({ kind: 'image-placeholder', convert: false })
    expect(decision.reason).toContain('截图工具')
    expect(shouldConvertHtml('<p>x</p>', '[Image #1]')).toBe(false)
  })

  it('still converts a real paste that happens to mention a placeholder', () => {
    expect(isImagePlaceholderText('see [Image #1] above')).toBe(false)
    expect(shouldConvertHtml('<p>see [Image #1] above</p>', 'see [Image #1] above')).toBe(true)
  })
})

describe('classifyPaste edge cases', () => {
  it('reports plain-text when there is no HTML at all', () => {
    expect(classifyPaste('', 'just text')).toMatchObject({ kind: 'plain-text', convert: false })
    expect(classifyPaste('   ', 'just text')).toMatchObject({ kind: 'plain-text', convert: false })
  })

  it('converts an image-only clipboard so the upload flow can pick it up', () => {
    expect(shouldConvertHtml('<img src="data:image/png;base64,AAAA">', '')).toBe(true)
    expect(htmlToDialect('<img src="data:image/png;base64,AAAA">')).toBe('![]()')
  })

  it('converts ordinary rich text', () => {
    expect(shouldConvertHtml('<div><h1>T</h1><p>正文 <strong>粗</strong></p></div>', 'T\n正文 粗')).toBe(true)
    expect(classifyPaste('<div><h1>T</h1></div>', 'T')).toMatchObject({ kind: 'convert', convert: true })
  })
})

// ---------------------------------------------------------------------------
// dirty source cleaning
// ---------------------------------------------------------------------------

describe('cleanHtmlSource', () => {
  it('drops Word conditional comments, office namespaces and styles', () => {
    const html =
      '<html><head><style>p{margin:0}</style><title>t</title></head><body>' +
      '<!--[if gte vml 1]><v:shape><v:imagedata src="file:///C:/x.png"/></v:shape><![endif]-->' +
      '<p class=MsoNormal>正文<o:p></o:p></p><!-- plain comment --></body></html>'
    const cleaned = cleanHtmlSource(html)
    expect(cleaned).not.toContain('v:shape')
    expect(cleaned).not.toContain('<o:p>')
    expect(cleaned).not.toContain('margin:0')
    expect(cleaned).not.toContain('plain comment')
    expect(cleaned).not.toContain('class=MsoNormal')
    expect(cleaned).toContain('正文')
  })

  it('keeps data-language but drops editor bookkeeping attributes', () => {
    const cleaned = cleanHtmlSource('<pre><code data-language="ts" data-block-id="b1" aria-label="x">y</code></pre>')
    expect(cleaned).toContain('data-language="ts"')
    expect(cleaned).not.toContain('data-block-id')
    expect(cleaned).not.toContain('aria-label')
  })

  it('never touches a data URI in src', () => {
    const cleaned = cleanHtmlSource('<img src="data:image/png;base64,AAAA" data-foo="1">')
    expect(cleaned).toContain('src="data:image/png;base64,AAAA"')
    expect(cleaned).not.toContain('data-foo')
  })
})

describe('Word paste', () => {
  const WORD_HTML = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset=utf-8><title>x</title>
<style>p.MsoNormal {margin:0cm}</style></head><body>
<p class=MsoNormal><span style="mso-spacerun:yes">&nbsp;&nbsp; </span><b style="color:#FF0000">红字</b>正文<o:p></o:p></p>
<p class=MsoNormal align=center>居中一句</p>
<!--[if gte vml 1]><v:shape style='width:10pt'><v:imagedata src="file:///C:/tmp/x.png"/></v:shape><![endif]-->
<p class=MsoNormal><a href="file:///C:/doc.htm">本地</a> 和 <a href="#_Toc1">锚点</a> 和 <a href="https://a.com/x?y=1&amp;z=2">真链接</a></p>
</body></html>`

  it('produces clean dialect Markdown', () => {
    expect(htmlToDialect(WORD_HTML)).toBe(
      '==**红字**==正文\n\n:::center\n居中一句\n:::\n\n本地 和 锚点 和 [真链接](https://a.com/x?y=1&z=2)',
    )
  })
})

describe('Feishu paste', () => {
  const FEISHU_HTML = `<div data-page-id="7123456" data-zone="cn">
  <h1 data-block-id="blk1">飞书文档标题</h1>
  <p data-record-id="rec1"><span style="color: rgb(31, 35, 41)">普通正文</span><span style="font-weight: 700; color: rgb(31, 35, 41)">加粗部分</span><span style="background-color: rgb(255, 246, 122)">高亮部分</span></p>
  <blockquote data-block-id="blk2"><p>引用的话</p></blockquote>
  <ul data-block-id="blk3"><li>项目一</li><li>项目二</li></ul>
</div>`

  it('maps styled spans and ignores the body-text colour', () => {
    expect(htmlToDialect(FEISHU_HTML)).toBe(
      '# 飞书文档标题\n\n普通正文**加粗部分**==高亮部分==\n\n> 引用的话\n\n- 项目一\n- 项目二',
    )
  })
})

describe('Notion paste', () => {
  const NOTION_HTML = `<div class="notion-page-content">
  <h2 class="notion-h2">Notion 小标题</h2>
  <div class="notion-text">普通 <span style="font-weight:600">加粗</span> <span style="text-decoration:underline">下划线</span></div>
  <pre class="notion-code-block"><code class="language-js">const a = 1</code></pre>
</div>`

  it('unwraps the notion-* divs and keeps the fence language', () => {
    expect(htmlToDialect(NOTION_HTML)).toBe(
      '## Notion 小标题\n\n普通 **加粗** ==下划线==\n\n```js\nconst a = 1\n```',
    )
  })
})

// ---------------------------------------------------------------------------
// block mappings
// ---------------------------------------------------------------------------

describe('headings', () => {
  it('maps h1-h3 one to one and collapses h4-h6 onto the third level', () => {
    expect(htmlToDialect('<h1>T1</h1><h2>T2</h2><h3>T3</h3><h4>T4</h4><h5>T5</h5><h6>T6</h6>')).toBe(
      '# T1\n\n## T2\n\n### T3\n\n### T4\n\n### T5\n\n### T6',
    )
  })

  it('does not let a literal pipe become a KICKER separator', () => {
    // `## A | B` is our kicker form; the source never means it.
    expect(htmlToDialect('<h2>A | B</h2>')).toBe('## A \uff5c B')
  })

  it('drops an empty heading instead of emitting a bare marker', () => {
    expect(htmlToDialect('<h2></h2><p>x</p>')).toBe('x')
  })
})

describe('inline emphasis', () => {
  it('maps strong/em/del/code', () => {
    expect(htmlToDialect('<p>a <strong>b</strong> <em>c</em> <del>d</del> <code>e</code></p>')).toBe(
      'a **b** *c* ~~d~~ `e`',
    )
  })

  it('uses two tildes, not the one the gfm plugin emits', () => {
    expect(htmlToDialect('<p><s>删掉</s> 和 <strike>也删掉</strike></p>')).toBe('~~删掉~~ 和 ~~也删掉~~')
  })

  it('maps mark, u and ins to ==重点==', () => {
    expect(htmlToDialect('<p><mark>甲</mark> <u>乙</u> <ins>丙</ins></p>')).toBe('==甲== ==乙== ==丙==')
  })

  it('maps a background-coloured span to ==重点==', () => {
    expect(htmlToDialect('<p><span style="background-color:yellow">高亮</span></p>')).toBe('==高亮==')
    expect(htmlToDialect('<p><span style="mso-highlight:yellow">word 高亮</span></p>')).toBe('==word 高亮==')
  })

  it('keeps bold inside the mark', () => {
    expect(htmlToDialect('<p><mark><strong>粗高亮</strong></mark></p>')).toBe('==**粗高亮**==')
    expect(htmlToDialect('<p><strong style="background:#FF0">高亮粗体</strong></p>')).toBe('==**高亮粗体**==')
  })

  it('never emits an empty or whitespace-padded ==', () => {
    // markdown-it-mark rejects `== a ==` and `====`, both of which would leak
    // raw delimiters into the article.
    expect(htmlToDialect('<p><mark>  </mark></p>')).toBe('')
    expect(htmlToDialect('<p>前 <mark>重点</mark> 后</p>')).toBe('前 ==重点== 后')
    expect(htmlToDialect('<p><mark> a </mark></p>')).toBe('==a==')
  })

  it('maps Notion/Feishu font-weight and font-style spans', () => {
    expect(htmlToDialect('<p><span style="font-weight:700">粗</span><span style="font-style:italic">斜</span></p>')).toBe(
      '**粗***斜*',
    )
  })

  it('leaves a plain body-colour span alone', () => {
    expect(htmlToDialect('<p><span style="color: rgb(31, 35, 41)">飞书正文色</span></p>')).toBe('飞书正文色')
    expect(htmlToDialect('<p><strong style="color:#333333">灰粗体</strong></p>')).toBe('**灰粗体**')
  })
})

describe('isAccentColor', () => {
  it('accepts saturated colours', () => {
    expect(isAccentColor('#FF0000')).toBe(true)
    expect(isAccentColor('rgb(192, 0, 0)')).toBe(true)
    expect(isAccentColor('#1677FF')).toBe(true)
    expect(isAccentColor('red')).toBe(true)
  })

  it('rejects body-text greys, black and white', () => {
    expect(isAccentColor('rgb(31, 35, 41)')).toBe(false) // Feishu body colour
    expect(isAccentColor('#333333')).toBe(false) // Word body colour
    expect(isAccentColor('black')).toBe(false)
    expect(isAccentColor('#ffffff')).toBe(false)
    expect(isAccentColor('inherit')).toBe(false)
    expect(isAccentColor('')).toBe(false)
  })
})

describe('isHighlightStyle', () => {
  it('accepts real highlights', () => {
    expect(isHighlightStyle('background-color:yellow')).toBe(true)
    expect(isHighlightStyle('BACKGROUND: #FF0')).toBe(true)
    expect(isHighlightStyle('mso-highlight:yellow')).toBe(true)
    expect(isHighlightStyle('text-decoration: underline')).toBe(true)
    expect(isHighlightStyle('text-decoration-line:underline')).toBe(true)
  })

  it('rejects transparent, white and image backgrounds', () => {
    expect(isHighlightStyle('background-color:transparent')).toBe(false)
    expect(isHighlightStyle('background: none')).toBe(false)
    expect(isHighlightStyle('background-color: rgb(255, 255, 255)')).toBe(false)
    expect(isHighlightStyle('background:#FFFFFF')).toBe(false)
    expect(isHighlightStyle('background-image: url(a.png)')).toBe(false)
    expect(isHighlightStyle('')).toBe(false)
    expect(isHighlightStyle('color:red')).toBe(false)
  })
})

describe('links', () => {
  it('keeps http links and drops file:, fragment, javascript: and empty hrefs', () => {
    const html =
      '<p><a href="https://example.com/a?b=1&amp;c=2">外链</a>、<a href="#_Toc99">内部锚点</a>、' +
      '<a href="file:///C:/Users/me/x.docx">本地文件</a>、<a href="javascript:void(0)">脚本</a>、' +
      '<a href="">空链接</a>、<a name="bookmark"></a></p>'
    expect(htmlToDialect(html)).toBe('[外链](https://example.com/a?b=1&c=2)、内部锚点、本地文件、脚本、空链接、')
  })

  it('percent-encodes spaces so the destination stays parseable', () => {
    expect(htmlToDialect('<a href="https://a.com/my page">x</a>')).toBe('[x](https://a.com/my%20page)')
  })
})

describe('tables', () => {
  it('emits GFM with alignment from both style and align attributes', () => {
    const html =
      '<table><thead><tr><th>甲</th><th style="text-align:center">乙</th><th align="right">丙</th></tr></thead>' +
      '<tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table>'
    expect(htmlToDialect(html)).toBe('| 甲 | 乙 | 丙 |\n| --- | :---: | ---: |\n| 1 | 2 | 3 |')
  })

  it('reads alignment off the paragraph inside the cell, as Word writes it', () => {
    const html = '<table><tr><td><p align="center">头</p></td></tr><tr><td>1</td></tr></table>'
    expect(htmlToDialect(html)).toBe('| 头 |\n| :---: |\n| 1 |')
  })

  it('promotes the first row of a header-less table instead of keeping raw HTML', () => {
    // The gfm plugin `keep`s such tables, which our dialect renders as literal
    // angle-bracket text.
    expect(htmlToDialect('<table><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>')).toBe(
      '| 1 | 2 |\n| --- | --- |\n| 3 | 4 |',
    )
  })

  it('escapes a pipe inside a cell and flattens multi-line cells', () => {
    const html = '<table><tr><th>a</th></tr><tr><td>x | y</td></tr><tr><td>line1<br>line2</td></tr></table>'
    expect(htmlToDialect(html)).toBe('| a |\n| --- |\n| x \\| y |\n| line1 line2 |')
  })

  it('survives whitespace between the table tags', () => {
    const html = '<table>\n  <thead>\n    <tr><th>甲</th><th>乙</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>1</td><td>2</td></tr>\n  </tbody>\n</table>'
    expect(htmlToDialect(html)).toBe('| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |')
  })
})

describe('lists', () => {
  it('keeps nesting with CommonMark-correct indentation', () => {
    // Bullets indent by 2, ordered items by 3: markdown-it only nests `1. b`
    // under `1. a` at three spaces, two is a lazy continuation.
    expect(htmlToDialect('<ul><li>a<ul><li>b<ol><li>c</li></ol></li></ul></li><li>d</li></ul>')).toBe(
      '- a\n  - b\n    1. c\n- d',
    )
    expect(htmlToDialect('<ol><li>a<ol><li>b</li></ol></li></ol>')).toBe('1. a\n   1. b')
  })

  it('honours the start attribute', () => {
    expect(htmlToDialect('<ol start="3"><li>c</li><li>d</li></ol>')).toBe('3. c\n4. d')
  })

  it('uses a single space after a task-list checkbox', () => {
    expect(htmlToDialect('<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul>')).toBe(
      '- [x] done\n- [ ] todo',
    )
  })
})

describe('blockquotes', () => {
  it('uses > for a single-paragraph pull quote', () => {
    expect(htmlToDialect('<blockquote><p>金句一句</p></blockquote>')).toBe('> 金句一句')
    expect(htmlToDialect('<blockquote>裸文本引用</blockquote>')).toBe('> 裸文本引用')
  })

  it('uses :::quote for several paragraphs', () => {
    expect(htmlToDialect('<blockquote><p>第一段</p><p>第二段</p></blockquote>')).toBe(':::quote\n第一段\n\n第二段\n:::')
  })

  it('uses :::quote when the content is not prose', () => {
    expect(htmlToDialect('<blockquote><ul><li>a</li><li>b</li></ul></blockquote>')).toBe(':::quote\n- a\n- b\n:::')
  })

  it('drops an empty blockquote', () => {
    expect(htmlToDialect('<blockquote><p>   </p></blockquote><p>x</p>')).toBe('x')
  })
})

describe('isQuoteCardContent', () => {
  it('accepts one paragraph of prose', () => {
    expect(isQuoteCardContent('金句')).toBe(true)
    expect(isQuoteCardContent('一行\n接着同一行')).toBe(true)
  })

  it('rejects multi-paragraph and structured content', () => {
    expect(isQuoteCardContent('甲\n\n乙')).toBe(false)
    expect(isQuoteCardContent('- a\n- b')).toBe(false)
    expect(isQuoteCardContent('> 嵌套')).toBe(false)
    expect(isQuoteCardContent('')).toBe(false)
  })
})

describe('centered blocks', () => {
  it('wraps a centered paragraph in :::center', () => {
    expect(htmlToDialect('<p style="text-align:center">居中强调</p>')).toBe(':::center\n居中强调\n:::')
    expect(htmlToDialect('<div align="center">居中div</div>')).toBe(':::center\n居中div\n:::')
    expect(htmlToDialect('<center>老式居中</center>')).toBe(':::center\n老式居中\n:::')
  })

  it('does not swallow a page-wide centered wrapper', () => {
    expect(htmlToDialect('<section style="text-align:center"><p>甲</p><p>乙</p></section>')).toBe('甲\n\n乙')
  })

  it('does not wrap a centered image, which :::center would drop', () => {
    // markdown-it-container only collects inline tokens, so an image inside
    // :::center never reaches the AST.
    expect(htmlToDialect('<p style="text-align:center"><img src="https://x/a.png"></p>')).toBe('![]()')
  })

  it('ignores a left-aligned paragraph', () => {
    expect(htmlToDialect('<p style="text-align:left">左</p>')).toBe('左')
  })
})

describe('code blocks', () => {
  it('infers the language from class, lang-, brush: and data-language', () => {
    expect(htmlToDialect('<pre><code class="language-typescript">let x: number = 1</code></pre>')).toBe(
      '```ts\nlet x: number = 1\n```',
    )
    expect(htmlToDialect('<pre><code class="lang-python">pass</code></pre>')).toBe('```python\npass\n```')
    expect(htmlToDialect('<pre class="brush: java">int i = 0;</pre>')).toBe('```java\nint i = 0;\n```')
    expect(htmlToDialect('<pre><code data-language="go">package main</code></pre>')).toBe('```go\npackage main\n```')
  })

  it('reads a GitHub highlight wrapper', () => {
    expect(htmlToDialect('<div class="highlight highlight-source-js"><pre>const a = 1</pre></div>')).toBe(
      '```js\nconst a = 1\n```',
    )
  })

  it('emits a bare fence when there is no language, and preserves indentation', () => {
    expect(htmlToDialect('<pre><code>if (a) {\n    b()\n}</code></pre>')).toBe('```\nif (a) {\n    b()\n}\n```')
  })

  it('lengthens the fence when the code itself contains one', () => {
    expect(htmlToDialect('<pre><code>``` inside</code></pre>')).toBe('````\n``` inside\n````')
  })

  it('does not escape Markdown inside a code block', () => {
    expect(htmlToDialect('<pre><code># not a heading\n* not a list</code></pre>')).toBe(
      '```\n# not a heading\n* not a list\n```',
    )
  })
})

describe('detectCodeLanguage', () => {
  it('normalises aliases and rejects unknown class names', () => {
    expect(detectCodeLanguage('language-javascript')).toBe('js')
    expect(detectCodeLanguage('hljs language-shell')).toBe('bash')
    expect(detectCodeLanguage('python')).toBe('python')
    expect(detectCodeLanguage('notion-code-block')).toBe('')
    expect(detectCodeLanguage('')).toBe('')
    expect(detectCodeLanguage(null)).toBe('')
  })
})

describe('rules and separators', () => {
  it('emits --- rather than turndown\'s default "* * *"', () => {
    expect(htmlToDialect('<p>a</p><hr><p>b</p>')).toBe('a\n\n---\n\nb')
  })

  it('turns <br> into a backslash hard break that survives whitespace stripping', () => {
    expect(htmlToDialect('<p>第一行<br>第二行</p>')).toBe('第一行\\\n第二行')
  })

  it('drops a hard break that ended up at the end of a paragraph', () => {
    expect(htmlToDialect('<p>末尾换行<br></p><p>next</p>')).toBe('末尾换行\n\nnext')
  })

  it('uses a figure caption as the image alt and does not print it twice', () => {
    expect(htmlToDialect('<figure><img src="https://x/a.png"><figcaption>图注文字</figcaption></figure>')).toBe(
      '![图注文字]()',
    )
  })

  it('drops non-content elements entirely', () => {
    expect(htmlToDialect('<p>a</p><svg><path d="M0 0"/></svg><iframe src="x"></iframe><p>b</p>')).toBe('a\n\nb')
  })
})

// ---------------------------------------------------------------------------
// images
// ---------------------------------------------------------------------------

describe('images', () => {
  it('blanks the src, including base64, and keeps the alt as the caption', () => {
    expect(htmlToDialect('<p>前</p><p><img src="data:image/png;base64,AAAA" alt="截图"></p><p><img src="https://x.com/a.png"></p>')).toBe(
      '前\n\n![截图]()\n\n![]()',
    )
  })

  it('lets the caller caption unnamed images', () => {
    const html = '<p><img src="data:image/png;base64,AAA"></p><p><img src="https://x/b.png" alt="原alt"></p>'
    expect(htmlToDialect(html, { imageAlt: (img, i) => (img.alt ? '' : `配图 ${i + 1}`) })).toBe(
      '![配图 1]()\n\n![原alt]()',
    )
  })

  it('extracts every uploadable image in document order', () => {
    const html =
      '<p><img src="data:image/png;base64,AAAA" alt="截图"></p>' +
      '<p><img src="https://x.com/a.png?b=1&amp;c=2" title="T"></p>' +
      '<p><img srcset="https://y/s.png 1x, https://y/l.png 2x"></p>' +
      '<img>'
    expect(extractImages(html)).toEqual([
      { src: 'data:image/png;base64,AAAA', alt: '截图', isDataUri: true },
      { src: 'https://x.com/a.png?b=1&c=2', alt: 'T', isDataUri: false },
      { src: 'https://y/s.png', alt: '', isDataUri: false },
    ])
  })

  it('ignores the noscript fallback image so captions stay aligned', () => {
    // Lazy-loading pages ship both a placeholder <img> and a <noscript> copy of
    // the real one. turndown drops <noscript>, so counting it there would shift
    // every later caption onto the wrong picture.
    const html =
      '<p><img src="https://cdn/real-1.png" alt="图一"></p>' +
      '<noscript><img src="https://cdn/real-1.png" alt="图一"></noscript>' +
      '<p><img src="data:image/png;base64,BBB" alt="图二"></p>'
    expect(htmlToDialect(html)).toBe('![图一]()\n\n![图二]()')
    const images = extractImages(html)
    expect(images.map((img) => img.alt)).toEqual(['图一', '图二'])
    expect(fillImageSlots(htmlToDialect(html), images.map((_, i) => `https://our.cdn/${i + 1}.webp`))).toBe(
      '![图一](https://our.cdn/1.webp)\n\n![图二](https://our.cdn/2.webp)',
    )
  })

  it('fills the placeholders back in, skipping fenced code', () => {
    const html = '<p><img src="data:image/png;base64,AAA" alt="截图一"></p><p>中间</p><p><img src="https://cdn.x/b.png"></p>'
    const images = extractImages(html)
    const urls = images.map((img) => `https://our.cdn/${img.isDataUri ? 'up1' : 'up2'}.webp`)
    expect(fillImageSlots(htmlToDialect(html), urls)).toBe(
      '![截图一](https://our.cdn/up1.webp)\n\n中间\n\n![](https://our.cdn/up2.webp)',
    )
    expect(fillImageSlots('![a]()\n\n```\n![keep]()\n```', ['https://u/1.png'])).toBe(
      '![a](https://u/1.png)\n\n```\n![keep]()\n```',
    )
  })

  it('encodes a URL that would break the Markdown destination', () => {
    expect(fillImageSlots('![a]()', ['https://u/my file (1).png'])).toBe('![a](https://u/my%20file%20%281%29.png)')
  })
})

// ---------------------------------------------------------------------------
// post-pass
// ---------------------------------------------------------------------------

describe('normalizeDialectMarkdown', () => {
  it('collapses blank-line runs to at most one blank line', () => {
    expect(normalizeDialectMarkdown('a\n\n\n\n\nb')).toBe('a\n\nb')
    expect(htmlToDialect('<div><p>a</p><p></p><p></p><p></p><p>b</p></div>')).toBe('a\n\nb')
  })

  it('strips trailing whitespace and zero-width characters', () => {
    expect(normalizeDialectMarkdown('a   \nb\t\n')).toBe('a\nb')
    expect(normalizeDialectMarkdown('零\u200b宽\ufeff字符\u2060')).toBe('零宽字符')
    expect(htmlToDialect('<p>零\u200b宽\ufeff字符</p>')).toBe('零宽字符')
  })

  it('keeps ZWJ so emoji sequences survive', () => {
    expect(normalizeDialectMarkdown('a\u200db')).toBe('a\u200db')
  })

  it('normalises CRLF and NBSP', () => {
    expect(normalizeDialectMarkdown('a\r\nb\r\n\r\nc')).toBe('a\nb\n\nc')
    expect(normalizeDialectMarkdown('a\u00a0b')).toBe('a b')
  })

  it('removes Word spacerun indentation but keeps list nesting', () => {
    expect(htmlToDialect('<p><span style="mso-spacerun:yes">&nbsp;&nbsp;&nbsp;&nbsp;</span>缩进正文</p>')).toBe('缩进正文')
    expect(normalizeDialectMarkdown('- a\n  - b')).toBe('- a\n  - b')
  })

  it('never rewrites the inside of a fence', () => {
    const src = '```\n  keep   me  \n\n\n\n```\n\n\n\nafter'
    expect(normalizeDialectMarkdown(src)).toBe('```\n  keep   me  \n\n\n\n```\n\nafter')
  })

  it('collapses an empty quote line to a bare >', () => {
    expect(normalizeDialectMarkdown('> a\n>   \n> b')).toBe('> a\n>\n> b')
  })

  it('trims the document', () => {
    expect(normalizeDialectMarkdown('\n\n\na\n\n\n')).toBe('a')
    expect(htmlToDialect('   ')).toBe('')
    expect(htmlToDialect('<style>x{}</style>')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// the output really is our dialect
// ---------------------------------------------------------------------------

describe('round-trip through parseMarkdown', () => {
  it('produces blocks the parser understands', () => {
    const doc = parseMarkdown(
      htmlToDialect(
        '<h1>大标题</h1>' +
          '<p>正文里有一个<span style="background:yellow">重点</span>。</p>' +
          '<p style="text-align:center">居中一句</p>' +
          '<blockquote><p>金句</p></blockquote>' +
          '<blockquote><p>引文甲</p><p>引文乙</p></blockquote>' +
          '<p><img src="data:image/png;base64,AAA" alt="配图"></p>' +
          '<hr>' +
          '<p>结尾 <a href="https://a.com">链接</a></p>',
      ),
    )
    expect(doc.blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'center',
      'quoteCard',
      'quoteBox',
      'image',
      'hr',
      'paragraph',
    ])

    const heading = doc.blocks[0]
    expect(heading.type === 'heading' && heading.numbered).toBe(false)

    const para = doc.blocks[1]
    expect(para.type === 'paragraph' && para.segs.some((s) => s.mark && s.text === '重点')).toBe(true)

    const center = doc.blocks[2]
    expect(center.type === 'center' && center.segs.map((s) => s.text).join('')).toBe('居中一句')

    const quoteCard = doc.blocks[3]
    expect(quoteCard.type === 'quoteCard' && quoteCard.segs.map((s) => s.text).join('')).toBe('金句')

    const quoteBox = doc.blocks[4]
    expect(quoteBox.type === 'quoteBox' && quoteBox.paras.map((p) => p.map((s) => s.text).join(''))).toEqual([
      '引文甲',
      '引文乙',
    ])

    const image = doc.blocks[5]
    expect(image.type === 'image' && image.alt === '配图' && image.src === '').toBe(true)

    const last = doc.blocks[7]
    expect(last.type === 'paragraph' && last.segs.some((s) => s.link === 'https://a.com')).toBe(true)
  })

  it('keeps ## as a numbered section heading with an empty kicker', () => {
    const doc = parseMarkdown(htmlToDialect('<h2>第二节</h2><p>正文</p>'))
    const heading = doc.blocks[0]
    expect(heading.type === 'heading' && heading.kicker === '' && heading.title === '第二节' && heading.numbered).toBe(
      true,
    )
  })
})
