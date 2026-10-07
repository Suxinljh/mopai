// Yoru 个人品牌印：YORU Content Design System「1a · 印 · 阴文」。
// 靛青方印（#2e4a68）+ 纸白「夜」字，设计系统注明「识别最强，任何尺寸都立得住」。
// 它是品牌层不是 UI 层，所以保留品牌原色，不跟随 console 的 primary。

export function YoruMark({ size = 26, radius }: { size?: number; radius?: number }) {
  const r = radius ?? Math.round(size * 0.22)
  return (
    <span
      aria-label="Yoru"
      role="img"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        background: '#2E4A68',
        color: '#F2F5F5',
        borderRadius: r,
        fontFamily: '"Source Han Serif SC", "Songti SC", "STSong", "SimSun", serif',
        fontWeight: 900,
        fontSize: size * 0.58,
        lineHeight: 1,
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      夜
    </span>
  )
}
