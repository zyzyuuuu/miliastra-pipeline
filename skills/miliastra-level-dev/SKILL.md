---
name: miliastra-level-dev
description: >-
  Use when the user wants to BUILD a new playable level / game in 原神千星奇域（Genshin
  Miliastra / 千星沙箱 UGC）— from an idea ("做一个黄金矿工""做一个跑酷关卡") to an importable
  .gil save. Covers the engineering pipeline the editor UI cannot do: control-tree budgeting
  (20 MiB / ~1,020 bytes per control), sprite-to-rectangle encoding for character art,
  initialization performance (UI-bridge calls per control), loading-curtain design,
  numeric/economy simulation, and the known pitfalls list. Also use when an existing
  custom level suffers: 5-second blank/solid-color screen on entry, save rejected for
  size, portrait looks like mosaic, icon shows "?" placeholder, or offline tests read
  empty strings. NOT for: querying official node semantics (use miliastra-ugc /
  miliastra-knowledge skill), live in-game playtesting (use 8itlab genshin-miliastra-mcp),
  or terrain/water painting (no tool covers it — manual editor work).
---

# 千星关卡工程化开发（从想法到 .gil）

把一个游戏想法变成能在千星奇域里导入的 `.gil`，编辑器手工做不了的部分全在这里。

**分工边界**（先记住，避免走错工具）：

| 这份 skill 管 | 别的工具管 |
|---|---|
| 工程管线：预算、立绘编码、初始化、加载幕、数值模拟 | 官方节点语义查询 → `miliastra-ugc` skill / Miliastra-toolbox |
| 什么时候砍分辨率、什么时候换原生图标 | 真机导入试玩 → 8itlab genshin-miliastra-mcp（Windows 专用） |
| 卡 5 秒、超体积、马赛克这些故障的定位 | 地形水体绘制 → 没有工具，编辑器手画 |

## 工作流程（按顺序，不要跳）

### 第 0 步：定预算，先于一切

在写任何代码之前，跑：

```bash
node scripts/budget.mjs --target-mib 20
```

规则：**20 MiB 上限 × 90% ≈ 18 MiB 可用 ÷ 1,020 B/控件 ≈ 18,500 控件。**

- 人物立绘是最贵的（192px 单人 4,600~6,600 块），预算第一刀切给人物
- 能用编辑器原生图标的一律用原生（1 控件，分辨率无关），自己编码只用于资源库里没有的东西
- 目标占用 >90% 时，选择顺序：调容差（38→42）→ 减非焦点元素 → 最后才降分辨率

详见 `references/budget.md`。

### 第 1 步：数值先行

把玩法数值抽成纯数据文件（一份 `core.js`，网页原型与原生构建共用）：

- 关卡目标曲线、物品期望收益、概率结构、商店定价
- 用脚本模拟完整通关曲线，验证设计目标（如"普通玩家约 10 关"）
- **数值必须单源。** 两份各改一份，三次以内必然不一致

### 第 2 步：立绘编码

```bash
node scripts/compile-sprites.mjs --in ./assets --out ./sprites.json \
  --spec hero:hero.png:192:38
```

- 192px / 容差 38 是画质与体积的交点；224px 是陡坡，别上
- **块外扩必须按比例**：`Math.min(1.2, Math.max(0.3, bw * scale * 0.12))`，固定像素只在一个分辨率上正确
- 96px 的官方立绘不是像素画（一张图 2,400+ 色），RLE/调色板量化几乎不减块

详见 `references/sprites.md`。

### 第 3 步：构建

推荐路线：**克隆官方教学存档做基底**，不要从零建（从零建的关卡导入不了）。

依赖底层工具 `miliastra-ugc-tools`（QHY8IV/miliastra-ugc，用户自备，环境变量 `MILIASTRA_TOOLS` 指向）：

```js
// 先跑 byte-preserving 往返验证，不过就停
if (!encodeGi({kind, root, version}).equals(fs.readFileSync(src))) throw Error('round-trip mismatch');
```

- 原型克隆 + guid 深递归重映射（漏一处会出现"控件存在但点不到"）
- 生成物（`main.generated.lua` / `controls.json`）**永远不要手改**
- 加载幕等"游戏开始前显示"的控件**必须挂 ScreenRoot**，挂 GameCanvas 会跟着一起被隐藏

架构详见 `references/pipeline.md`。

### 第 4 步：本地验证

- 结构：`checkGi` / `checkUiTree`
- 静态：Lua lint
- 行为：场景断言测试。**测试帧数必须跟控件数走**（控件数 ÷ 每帧 96，再留余量），改控件数必须同步改帧数，否则测到的是未初始化的空控件
- 大套测试分进程跑（18,000 控件 + Lua 模拟会触 V8 4GB 堆上限，别调堆，拆进程）

### 第 5 步：交付红线

1. **一切产物声明"未在真机验证"**，附导入检验步骤
2. 不覆盖用户已有存档（输出新路径 + 提醒先备份）
3. 不引用未核对过的图标编号（错了不报错，显示 "?"）
4. 原神美术素材不进任何交付物仓库（版权红线）

## 常见故障速查

| 症状 | 大概率原因 | 处理 |
|---|---|---|
| 进关 3~5 秒纯色空屏 | 初始化桥调用过多 + GameCanvas 被隐藏 | 砍调用（13→4 次/控件），加载幕挂 ScreenRoot |
| 提分辨率后反而更糊 | 固定像素外扩吃掉细节 | 外扩改按块宽 12% 取比例 |
| 导入报空间不足 | 文件没超 20 MiB 但控件树超了 | 预算按 88% 停手，跑 budget.mjs 核 |
| 图标显示 "?" | 编号未核对 | 查资源库截图记录，编号要有出处 |
| 测试大面积空字符串断言 | 帧数没跟控件数走 | 按新控件数重标定帧数 |
| 文字全不显示（低等级账号） | 奇匠 Lv.1 已知显示问题 | 规避：Lv.2 账号验收 |

完整 12 条坑见 `references/pitfalls.md`。

## 证据纪律（沿用社区约定）

- 结论带证据等级：【文档】/【官方示例】/【实测】/【未确认】
- 离线模拟的结果写"离线模拟：…"，不冒充真机事实
- 布局烘焙进存档这类**假设性优化**，交付时必须写明假设与回退方法
