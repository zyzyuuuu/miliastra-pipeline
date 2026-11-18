# 构建管线：从 core.js 到 .gil

## 四层结构与职责

```
规则层 core.js        纯数据+纯函数，禁 DOM/window 等副作用；网页版与原生构建共用（数值单源）
呈现层 art.js+sprites 形状怎么画，不决定画什么
构建层 build.mjs      克隆官方存档骨架 → 注入控件树+Lua → 输出 .gil
校验层 check/lint/test 结构、格式、静态、行为四类
```

## 基底：克隆官方教学存档，不从零建

从零自建的关卡无法导入。正确做法：

```js
const f = readGi('official-client-script-sample.gil');

// 1. byte-preserving 往返验证，不过就停（保证后续改动只来自你的代码）
if (!encodeGi({kind: f.kind, root: f.root, version: f.container.version})
      .equals(fs.readFileSync(src))) throw Error('round-trip mismatch');

// 2. 接管官方示例的 UI 子树
const ownerId = [...buildUiTree(f.root).scripts.values()][0];
removeChildren(ownerId);   // 清掉示例控件

// 3. 注入自己的控件树
const canvas = clone('container', 'GameCanvas', owner);
```

工具依赖：`miliastra-ugc-tools`（QHY8IV/miliastra-ugc），环境变量 `MILIASTRA_TOOLS` 指向。提供 readGi/decodeGi/encodeGi/writeGi、buildUiTree、checkGi/checkUiTree。

## 原型克隆 + guid 重映射

不手构节点结构，从官方存档里找模板克隆：圆圈图片 / 分数文本 / 圆圈点击区域 / 圆圈容器。

克隆后必须**深递归重映射所有 guid 引用**（字段名包括 `guid` 与 `v`）：

```js
function remap(o, from, to) {
  if (!o || typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o)) {
    if ((k === 'v' || k === 'guid') && v === from) o[k] = to;
    else if (v && typeof v === 'object') remap(v, from, to);
  }
}
```

新 guid 从 `0x40001000` 起顺序分配，避开官方号段。漏掉一处引用 → "控件存在但点不到"类诡异故障。

## 初始化：调用次数决定时长

- 每控件只做必要的 4 次调用；`SetAsLastSibling` 不调（构建顺序即兄弟顺序）
- 布局属性优先烘焙进存档静态字段（**这是假设，需交付时写明回退方法**：恢复逐控件 pos()）
- 加载幕挂 **ScreenRoot**（GameCanvas 被隐藏时其子控件全部不可见），只用基础形状 100001/100002，不引用未核对图标
- 进度挂 initialize()：每帧处理固定数量控件，更新进度条

## 生成物纪律

| 手写 | 生成（勿改） |
|---|---|
| main.lua、build.mjs、core.js | main.generated.lua、controls.json、sprites.json |

改数值只改 core.js，重新构建。生成物会在下次构建被覆盖。

## 校验清单

1. 构建：`checkGi` / `checkUiTree` issues 为空
2. Lua lint：0 错 0 警
3. 场景断言：**帧数 = ceil(控件数/每帧处理数) + 余量**；控件数变了必须同步改
4. 数值模拟：通关曲线落在设计区间
5. 大套测试分进程跑（V8 默认 ~4GB 堆，别调堆，拆 4 进程）
6. 交付声明"未在真机验证" + 导入检验步骤
