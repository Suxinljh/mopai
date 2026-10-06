declare module 'markdown-it-mark' {
  import type MarkdownIt from 'markdown-it'
  const plugin: (md: MarkdownIt) => void
  export default plugin
}

declare module 'markdown-it-container' {
  import type MarkdownIt from 'markdown-it'
  const plugin: (md: MarkdownIt, name: string, options?: unknown) => void
  export default plugin
}
