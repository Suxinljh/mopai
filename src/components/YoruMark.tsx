// Yoru 个人品牌标：YORU Content Design System「3b · 月相行」。
// 新月 → 上弦 → 满月 → 下弦，四个阴晴圆缺排成一行——「没有字，但有叙事：一夜过去。」
// 满月吃 --logo-moon，其余月相吃 --logo-ink；两套主题各给一组值
// （akari 是墨色 + 品牌靛青 #2E4A68，yoru 换成浅墨 + 浅长春花蓝），
// 所以标记在明暗两种页面里都立得住。品牌语义不变：一夜过去。

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
      <circle cx="11" cy="12" r="10" fill="none" stroke="var(--logo-ink)" strokeWidth="1.67" />
      {/* 上弦 */}
      <path d="M41.2 2 a10 10 0 0 1 0 20 a5.5 10 0 0 0 0 -20" fill="var(--logo-ink)" />
      {/* 满月 · 品牌靛青 */}
      <circle cx="71.5" cy="12" r="10" fill="var(--logo-moon)" />
      {/* 下弦 */}
      <path d="M101.7 2 a10 10 0 0 0 0 20 a5.5 10 0 0 1 0 -20" fill="var(--logo-ink)" />
    </svg>
  )
}
