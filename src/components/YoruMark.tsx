// Yoru 个人品牌标：YORU Content Design System「3b · 月相行」。
// 新月 → 上弦 → 满月 → 下弦，四个阴晴圆缺排成一行——「没有字，但有叙事：一夜过去。」
// 满月吃品牌靛青 #2E4A68，其余月相保持墨色 #1B2127。
// 品牌层不是 UI 层，保留品牌原色，不跟随 console 的 primary。

export function YoruMark({ height = 18 }: { height?: number }) {
  // viewBox 130x24（四枚 r=10 的月相，按 3b 原版 260x48 等比缩小一半）
  const width = Math.round((height * 130) / 24)
  return (
    <svg
      role="img"
      aria-label="Yoru"
      width={width}
      height={height}
      viewBox="0 0 130 24"
      style={{ display: 'inline-block', flexShrink: 0, userSelect: 'none' }}
    >
      {/* 新月 */}
      <circle cx="11" cy="12" r="10" fill="none" stroke="#1B2127" strokeWidth="1.67" />
      {/* 上弦 */}
      <path d="M41.2 2 a10 10 0 0 1 0 20 a5.5 10 0 0 0 0 -20" fill="#1B2127" />
      {/* 满月 · 品牌靛青 */}
      <circle cx="71.5" cy="12" r="10" fill="#2E4A68" />
      {/* 下弦 */}
      <path d="M101.7 2 a10 10 0 0 0 0 20 a5.5 10 0 0 1 0 -20" fill="#1B2127" />
    </svg>
  )
}
