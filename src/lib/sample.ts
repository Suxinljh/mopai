// 默认示例稿：用本工具的语法写成的<SAMPLE_COMPANY>生态稿
// （渲染结果应与 Golden Sample 视觉一致，作为 golden 主题的验收样例）

export const SAMPLE_DOC = `---
titles:
  - 让技术与需求更快相遇：<SAMPLE_COMPANY>的人工智能生态实践
  - 从一个人到一整个生态：OPC 创业如何被托举
  - <SAMPLE_COMPANY> <SAMPLE_COMPANY>：连接技术、人才、场景与产业
cover: 主视觉建议用<SAMPLE_COMPANY>平台或活动现场图
---

人工智能正加速进入产业应用，也在改变创新创业的组织方式。

围绕人工智能技术应用、成果转化与新型创业主体培育，==<SAMPLE_COMPANY>（<SAMPLE_COMPANY>）持续连接技术、人才、场景与产业资源==，推动更多创意从想法走向项目、从项目走向真实应用。

## CONNECTION | 让技术与需求更快相遇

面对人工智能应用中的技术门槛、场景匹配和资源连接等问题，<SAMPLE_COMPANY>持续汇聚企业、开发者、创业者、高校院所及产业伙伴，推动需求与能力高效对接。

:::center
让技术找到场景，让需求找到答案。
:::

![<SAMPLE_COMPANY>平台或人工智能应用场景展示]()

## OPC ECOSYSTEM | 从一个人，连接一整个生态

人工智能工具正在降低个人和小型团队的创新门槛，也为==OPC 等新型创业形态==打开更多空间。围绕创业者成长需求，<SAMPLE_COMPANY>持续连接技术、算力、人才、金融、市场及产业资源。

> 让个体保持轻量，让生态承担重量。

![OPC 创业者、团队交流或平台活动现场]()

## REAL PROJECTS | 从连接走向真实成果

以真实项目为牵引，<SAMPLE_COMPANY>推动技术能力与应用场景精准匹配，让合作在对接、验证、落地的闭环中不断加深。

:::quote
「从需求对接到项目落地，平台提供了完整的资源支持，让团队可以专注在技术和产品本身。」
:::

![项目签约、交流活动或合作现场]()

## FUTURE | 面向未来的人工智能生态

人工智能的发展不止于技术本身，更关乎组织方式与协作生态的重构。<SAMPLE_COMPANY>将继续与产业伙伴同行，推动更多人工智能应用走向真实场景。

![<SAMPLE_COMPANY>活动合影或生态展示]()

## MULTI-IMAGE | 多图内容：先统一真实画幅，再进入轮播

同一主题的多张图片可采用横向滑动展示。轮播内图片应先从原图逐张裁成真实统一比例，再嵌入正文；人物、人脸、展板标题和关键信息应完整保留。

:::carousel 同主题 · 真实统一 4:3 轮播示范
![设备展示示范图]()
![团队协作示范图]()
![应用场景示范图]()
:::

:::quote
特殊比例图片单独展示；轮播不得依赖 object-fit、固定高度或留白补框伪造统一比例。
:::

@signature
`

// 语法速查，供编辑器内帮助面板
export const CHEATSHEET: { syntax: string; desc: string }[] = [
  { syntax: '==重点==', desc: '下划线重点（行内）' },
  { syntax: '## KICKER | 标题', desc: '章节标题，序号自动编号' },
  { syntax: '### 小标题', desc: '次级标题，无序号' },
  { syntax: '> 金句', desc: '金句卡片' },
  { syntax: ':::quote … :::', desc: '引文框，可多段' },
  { syntax: ':::center … :::', desc: '居中强调句' },
  { syntax: '![图注说明]()', desc: '图片占位，图号自动' },
  { syntax: ':::carousel 标题 … :::', desc: '图片轮播，内放多行 ![]()' },
  { syntax: '@signature', desc: '署名块（人员在设置中配置）' },
  { syntax: '<!-- 备注 -->', desc: '编辑备注，不渲染' },
  { syntax: '--- titles: - … ---', desc: 'front matter：标题候选、封面说明' },
]
