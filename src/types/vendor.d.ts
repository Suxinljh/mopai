// Vendors that ship no type declarations. turndown itself is covered by
// @types/turndown and mammoth by its own lib/index.d.ts.

declare module 'turndown-plugin-gfm' {
  import type { Turndown } from 'turndown'
  export const gfm: Turndown.Plugin
  export const tables: Turndown.Plugin
  export const strikethrough: Turndown.Plugin
  export const taskListItems: Turndown.Plugin
  export const highlight: Turndown.Plugin
}
