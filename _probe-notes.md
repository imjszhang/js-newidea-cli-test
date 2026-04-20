# Probe Notes — `review.newidea.pro/outline`

本文件记录阶段 0 的只读侦察结果，供 `outline-bridge.js` / `outline-cli.js` 实装时参照。**选择器常量在本文件第 3 节已冻结**。

---

## 1. 技术栈指纹

- Next.js production（`/_next/static/chunks/*.js`）
- React（生产构建剥离了 `__reactProps$…` / `__reactFiber$…`，**无法从 DOM 走 Fiber 反查 rc-tree 的 `eventKey`**）
- 树组件：[rc-tree](https://github.com/react-component/tree) —— 根 `div.rc-tree.outline-tree[role="tree"]`
- 编辑器：**Slate / Plate**（`<body>` class 含 `[&_.slate-selected]:!bg-primary/20 [&_.slate-selection-area]:border`；父链包含 `.slate-SelectionArea`）
- Tooltip：Radix UI（节点上 `<button data-state="closed">` 都是 Radix Tooltip trigger；**只响应真实鼠标悬停**）
- 样式：Tailwind（class 含 `group-hover:flex hidden`、`bg-primary/5`、`size-6` 等）
- 无 iframe、无 shadow DOM；视口 1641×885

## 2. 结构速览

```
<body>
├─ <header>            4-step 进度条（STEP 2 当前）
├─ main 内容（不用管）
│  └─ .rc-tree.outline-tree[role=tree]  @ (252, 152, 1138×1606)
│     ├─ .rc-tree-treenode[aria-hidden=true]   (rc-tree 内部占位，过滤)
│     └─ .rc-tree-treenode                   ← 我们关心的，61 个
│        ├─ .rc-tree-indent > .rc-tree-indent-unit ×N        depth = N
│        ├─ .rc-tree-switcher.{_open | _close | -noop}       (-noop = leaf)
│        └─ .rc-tree-node-content-wrapper
│           └─ .rc-tree-title
│              └─ div.flex.justify-between
│                 ├─ div.cursor-pointer          ← 节点文本，双击进入编辑
│                 └─ div.group-hover:flex.hidden ← 悬停按钮组（3 个 Radix tooltip trigger）
└─ 底部 CTA 条          @ y ≈ 774
   ├─ 返回首页
   ├─ 下载提纲
   └─ 生成全文          ← STEP 3 入口
```

## 3. 冻结选择器常量

```js
const SEL = {
  tree:         '.rc-tree.outline-tree[role="tree"]',
  node:         '.rc-tree-treenode',
  nodeFilter:   n => (n.getAttribute('aria-hidden') || 'false') !== 'true'
                     && n.getBoundingClientRect().height > 0,
  indentUnit:   ':scope > .rc-tree-indent > .rc-tree-indent-unit',
  switcher:     ':scope > .rc-tree-switcher',
  switcherOpen: 'rc-tree-switcher_open',
  switcherClose:'rc-tree-switcher_close',
  switcherNoop: 'rc-tree-switcher-noop',
  wrapper:      ':scope > .rc-tree-node-content-wrapper',
  title:        ':scope > .rc-tree-node-content-wrapper .rc-tree-title',
  label:        ':scope > .rc-tree-node-content-wrapper .rc-tree-title > div > div.cursor-pointer',
  hoverGroup:   ':scope > .rc-tree-node-content-wrapper .rc-tree-title div.group-hover\\:flex',
  hoverButtons: ':scope > .rc-tree-node-content-wrapper .rc-tree-title div.group-hover\\:flex > button',
  editor:       '[contenteditable="true"]',
  // 仅当编辑态下可见；选择器要加"可见性过滤" rect.width>50 && rect.height>20
  editorSibButtons: {
    generate: '一键生成',
    copy:     '一键复制',
    replace:  '替换原文',
  },
};
```

CTA 文本常量：
```js
const CTA = ['返回首页', '下载提纲', '生成全文'];
const EDITOR_CTA = ['一键生成', '一键复制', '替换原文'];
```

## 4. 节点层级与按钮分布（实测）

| depth | 节点数 | 字重 class | 悬停按钮数 | 例文 |
|---|---|---|---|---|
| 0 | 1 | `font-bold` | 1 | 星形胶质细胞与神经元沟通中的G蛋白偶联受体：机制、功能与治疗前景综述 |
| 1 | 8 | `font-medium` | 3 | 摘要：/ 前言：/ ... |
| 2 | 20 | 默认 | 3 | 段落标题或段落正文 |
| 3 | 32 | 默认 | 3 | 子要点（- 开头的要点） |

3 个悬停按钮的 svg 指纹（每个都被 Radix tooltip 包装，无 `aria-label` / `title`）：

- `pen`  —— `M1.95381 12.9287H4.56548…` + 底部水平线  → 语义上是"编辑"
- `copy` —— `M6.03212 4.63246H14.1339…` 两层重叠矩形 → 语义上是"复制"
- `?3`   —— `M13.5752 0…` 右上 + 右下两个矩形 + L 形连接 → 未决，可能是"插入参考"

**重要结论**：**3 个悬停按钮都不接受任何形式的程序化点击**。实测 `.click()` / `MouseEvent('click')` / `MouseEvent('mousedown'+'mouseup')` / `PointerEvent('pointerdown'+'pointerup')` 都无效，按钮 `data-state` 保持 `"closed"`，DOM 无任何变化。结论：**桥接脚本不依赖这 3 个按钮。**

## 5. 编辑入口（✅ 可用）

- **进入编辑态**：对 `div.cursor-pointer` 派发 `dblclick` 事件 —— `new MouseEvent('dblclick', { bubbles:true, cancelable:true, button:0 })` → 立即生效。
- **编辑器**：在原 label 位置就地替换为 `<div contenteditable="true" class="relative whitespace-pre-wrap break-words size-full rounded-md bg-background px-3 py-2 …">`，外层 `.slate-SelectionArea`。
- **副作用**：对**非叶子节点**进入编辑态会把子节点折叠进编辑器（target switcher 从 `_open` → `_close`），编辑器内容是"header + 所有子节点文本"的拼接。**桥接 API 因此区分两种编辑**：
  - 叶子节点（switcher-noop）→ `rename` / `editBody` 等价，编辑单行
  - 非叶子 → 整段合并编辑；API 按"section body" 对待
- **编辑态下多出 3 个辅助 CTA**（位置浮动在右侧）：
  - `一键生成`（顶部）：AI 重新生成内容
  - `一键复制`：复制到剪贴板
  - `替换原文`：**提交编辑**（未亲测，但语义最接近 commit；shadcn button，应接受 `.click()`）
- **关闭 / 取消编辑态**：实测 Escape / body.click / blur / elementFromPoint click 全部无效（Slate 同样依赖真实 trusted 事件判定 outside click）。**目前已知唯一的关闭方式是 `location.reload()` 或点击 `替换原文`（需实装时验证）**。
- **Phase 2 实装策略**：
  1. 进入编辑前先记录 `node.switcherClass`，用于恢复判断。
  2. 进入编辑后先全选清空 —— `document.getSelection().selectAllChildren(ed)` + 派发 `beforeinput: deleteContentBackward`；
  3. 派发 `beforeinput: insertText` / `InputEvent('input', {inputType:'insertText', data:text})` 写入新内容；
  4. 点击"替换原文"按钮提交（`.click()`）；
  5. 若需取消（未修改，只是误入编辑），则 `location.reload()` 兜底 —— 需要 `rename(path, null)` / `cancelEdit()` API 明确告知调用方会丢失未保存状态。

## 6. CTA（✅ 可用）

- 全局 CTA `返回首页` / `下载提纲` / `生成全文` 按 `innerText.trim() === '<name>'` 定位 button，`.click()` 可用（shadcn button，非 Radix trigger）。
- 编辑态 CTA `一键生成` / `一键复制` / `替换原文` 同上。

## 7. 选中 / 展开 / 折叠 — [已推翻 2026-04-21，见 §12]

- 选中：**当前页面不支持节点选中状态**（实测 `.rc-tree-node-selected` 永远为空；rc-tree 的 `selectable=false`）。`select(path)` API 实际做的只有 `scrollIntoView`。
- 展开/折叠：**实测程序化点击 switcher 完全无效**（click / pointerdown+up / mousedown+mouseup 全试过，节点仍保持原状态）。经诊断：事件成功传到 document 的 capture/bubble 阶段，但 React 绑定的 onClick 不响应 `isTrusted=false` 的合成事件。API 改为"先检查当前状态，若已是目标态返回 ok；否则尝试 click 并检查是否变化，未变化返 `E_NOT_SUPPORTED`"。
- **重要**：此页的展开态实际上由"进入编辑模式"的副作用驱动，单独的 switcher 切换在日常使用中不发生。

> **推翻理由**：根因不是 `isTrusted` 门禁，而是 Firefox 扩展 content-script 的 Xray 屏障。穿 `wrappedJSObject` / page-world 脚本注入后，`switcher` 的 `__reactProps$.onClick` 可以直接调，展开/折叠完全可自动化。rc-tree 的 `selectable=false` 仍然成立，`select` 语义不变。

## 8. 写操作的硬限制（Phase 2 关键结论） — [已推翻 2026-04-21，见 §12]

**全面实测后的残酷事实**：此站 React 应用对 `executeScript` 派发的合成事件几乎全方位屏蔽。已在三条路径上各失败一次：

1. **Radix Tooltip 按钮**（`data-state="closed"`，3 个悬停图标）：`.click()` / pointer / mouse 事件组合，`data-state` 保持 `closed`，无任何 DOM 变化。
2. **rc-tree switcher**（展开/折叠）：事件传到 document capture/bubble 但 React onClick 无响应。
3. **shadcn 按钮"替换原文"**：在编辑态下通过 `.click()` 点击，编辑器不关闭。更有甚者，按钮的 `disabled=true` 属性由 Slate 的 React 内部状态驱动，**只有真实用户在编辑器里输入（trusted input）才会把按钮解禁**，程序化 `beforeinput` 虽然改了 DOM 的 textContent，却无法让 React 状态同步 → 按钮依然 disabled → `.click()` 无效。

**`execCommand` / `beforeinput` 输入尝试**：
- `document.execCommand('selectAll')` 在该 contenteditable 上返回 `false`，无效。
- `document.execCommand('insertText', ...)` 亦不改变 DOM。
- `InputEvent('beforeinput', {inputType:'insertText', data:'...'})` 确实追加 text 到 DOM，但不走 Slate 的 React model，按钮仍 disabled。

**键盘关闭编辑器尝试**（Escape / Enter / Ctrl+Enter / blur）：全部无效。

**结论**：
- 本桥接脚本**不能完全自动化写操作**。
- Phase 2 最多做到"半自动"：`beginEdit(path)` 双击打开编辑器 + `awaitEditClosed({timeout})` 轮询等待用户在真实浏览器中手动点击"替换原文"。
- `rename(path, text)` / `editBody(path, text)` 由于无法靠程序让"替换原文"按钮可点，只能返回 `E_NEEDS_MANUAL` + 明确提示用户。
- `addChild` / `addSibling` / `remove` 完全无法实现，返回 `E_NOT_SUPPORTED_BY_PAGE`。

## 9. 隐藏按钮（`group-hover:flex hidden`）—— 暂不必破解 — [已推翻 2026-04-21，见 §12]

原计划用"临时 CSS override 显示按钮再点击"的方案，但第 4 节已证明这三个按钮本身不响应程序化事件。方案作废，CSS override 保留为"诊断用可视化开关"，实装时挂到 `__unveil()` 作可选调试工具，不走生产路径。

> **推翻理由**：同 §7/§8。穿 Xray 后这三个按钮的 `onClick` 也都可以直接调；但实际项目里我们连 hover 都没用 —— 直接从 label 向上 30 层走到 `Z` 组件，拿它挂的 `onEditNode` / `onAddChildNode` / `onAddSibNode` / `onDeleteNodes` 四个 handler 改数据模型。见 §12。

## 9b. 关键 CTA 按钮点击现状（Phase 3） — [已推翻 2026-04-21，见 §12]

| 按钮 | 是否 Radix | `.click()` 可用？ | 说明 |
|---|---|---|---|
| `返回首页` | 否（shadcn） | 未测（破坏性） | 预期不可用，参考"替换原文" |
| `下载提纲` | 否（shadcn） | 未测 | 预期不可用 |
| `生成全文` | 否（shadcn） | 未测（高破坏性） | 预期不可用 |

**推定结论**：所有此页 CTA 走 React onClick，同"替换原文"一样不响应合成点击。`clickCta` 实装为"派发 click 后 3s 内若 URL/DOM 未变则返 `E_NEEDS_MANUAL`"。

> **推翻理由**：page-world 脚本注入后，直接取 `btn.__reactProps$.onClick` 并以"伪造但 React 可消费"的事件对象调用，均能生效。`下载提纲` 实测打开了下载对话框；`返回首页` / `生成全文` 会离开 `/outline`，在 CLI 侧被 `--confirm` 软拦截，不在自动化 smoke 中真跑。

## 10. 已验证的技术细节

- `js-eyes` 在当前环境无需 consent（`enforcement=soft`）。
- `allowRawEval=true`、`newidea.pro` 在 egress 白名单 —— executeScript 直通。
- `BrowserAutomation.executeScript(tabId, code)` 对表达式返回 `result`，若代码末尾是 Promise 会自动 await。
- 脚本里不能用 `//` 注释写 ES module（目前用 IIFE 就够）。

## 11. 未决 / 后续 — [已大部分解决，见 §12]

- ~~`替换原文` 按钮的 `.click()` 行为、编辑器是否真的被关闭~~ → 不再走替换原文，改调 `Z.props.onEditNode`。
- ~~Phase 2b 的"新增 / 删除 / 拖拽重排"策略取决于 Slate 的行内 Enter/Tab/Backspace 响应~~ → 改为直接用 `onAddChildNode` / `onAddSibNode` / `onDeleteNodes`，完全不走 Slate。
- `生成全文` 点击后会离开 `/outline` 路由，桥接脚本生命周期结束；CLI 需据此返回 `{ok, newUrl}` 后自行断连 —— 此条仍有效。
- 拖拽重排：rc-tree 的 react-dnd 通道暂未探。若需要，思路是走 `onEditNode` 重写整棵 children 数组，不走 drag 事件。

---

## 12. Xray 根因与 Z handlers 通道（2026-04-21）

**这一节覆写 §4（图标不响应）/ §7（switcher 不响应）/ §8（写操作硬限制）/ §9（隐藏按钮）/ §9b（CTA 硬限制）的"硬限制"结论。** 原文保留，仅作溯源用。

### 12.1 根因：Firefox Xray 屏障，不是 `isTrusted`

`js-eyes` 的 `executeScript` 把代码 eval 在 Firefox 扩展 content-script 的 Xray 视图里。Xray 视图会把 DOM 元素的页面级 expando（`__reactFiber$*`, `__reactProps$*`）、`window.__NEXT_DATA__`、Slate / Plate editor 实例等**全部过滤成 undefined 或空对象**，并且跨 realm 的函数调用会触发 `Permission denied to access property …` 异常。

表象和"事件 isTrusted 被拦"几乎一模一样：

- `el.__reactProps$xxx` 返 `undefined` → 感觉像"按钮没有 React handler"。
- `el.click()` 完整派发，但 React 的合成事件管线跑在页面 principal，与 content-script 是两个 realm，handler 既读不到可用的 `currentTarget` 也拿不到事件本体 → 现象是"事件没人接"。
- Slate editor 即便拿到引用，传给它的 range `[]`、事件对象 `{}` 都会在跨越 Xray 时被拒绝访问 `Symbol.toStringTag` / `defaultPrevented`。

**穿透方式 A**：`el.wrappedJSObject` / `window.wrappedJSObject` 拿到页面 principal 的真实对象引用。Chrome 下 content-script 无 Xray，`unwrap(x)` 直接返 `x`，天然兼容。

**穿透方式 B**（生产用的）：创建 `<script>` 元素把字符串形式的 payload 注入 `document.documentElement`，payload 跑在页面 principal，没有任何 Xray，`__reactFiber$*`、React handlers、Slate editor、事件对象都是"自家"的。结果通过 `window.__JSE_OUTLINE_RET__ = JSON.stringify(...)` 写回，content-script 用 `window.wrappedJSObject.__JSE_OUTLINE_RET__` 读成字符串（原始值跨 Xray 不受限）。这条通道就是 bridge 里的 `runInPage()`。

### 12.2 发现 `Z` 组件 → 四个数据层 handler

在任意 rc-tree 节点 `.rc-tree-treenode` 的 label `<div class="cursor-pointer">` 上拿 `__reactFiber$`，沿 `.return` 向上 30 层左右会命中一个组件（源码里代号 `Z`），它的 `memoizedProps` 上挂：

| prop | 签名 | 效果 |
|---|---|---|
| `item` | `{ key, title, children }` | 当前节点在 React 数据模型里的对象 |
| `onEditNode(newNodes, key)` | 用 `newNodes` 数组替换 `key` 指向的节点及其子树 | rename / editBody / addChild / addSibling 全部通过它实现（改 children 数组后回写父节点） |
| `onAddChildNode(key)` | 插入一个空子节点并进入编辑态 | 当前不使用（bridge 选择直接用 `onEditNode` 重写 children 以便一步到位写入文本，避免二次提交） |
| `onAddSibNode(key)` | 插入一个空后兄弟节点 | 同上，不使用 |
| `onDeleteNodes([key, ...])` | 批量删除 | `remove` 的唯一通道，不会触发 Radix AlertDialog |

**关键好处**：不用打开 Slate 编辑器、不依赖"替换原文"按钮（它是"用 AI 输出覆盖节点"专用，`disabled` 由 `!outputs` 决定，和手动编辑无关），也不用模拟 hover 按钮组。整个写流水线变成纯数据层操作。

### 12.3 Z 组件的查找协议（bridge 里的 `pwFindZ`）

```
content-script:
  1. 扫 DOM 取到 path=a.b.c 的 .rc-tree-treenode
  2. setAttribute('data-jse-op', randomToken)   (唯一标记)
  3. runInPage(payload)  // payload 是字符串
page-world:
  4. document.querySelector('[data-jse-op="…"]')
  5. 从元素的 label 取 __reactFiber$* 起点
  6. 沿 fiber.return 最多 40 层，首个 memoizedProps 同时带 'onEditNode' 和 'item' 即为 Z
  7. 调 handler，JSON.stringify 写回 window.__JSE_OUTLINE_RET__
content-script:
  8. 轮询 window.wrappedJSObject.__JSE_OUTLINE_RET__ 取回
  9. removeAttribute('data-jse-op')
```

40 层是观测得来的上限（实测 30 层），留一倍冗余。"命中 Z"的判据：`'onEditNode' in mp && 'item' in mp`，比"类型是 `Z`"更稳（函数名在生产 bundle 里会变）。

### 12.4 switcher / CTA / 编辑器按钮也走 page-world

- 展开/折叠：`.rc-tree-switcher` 的 `__reactProps$.onClick` 在 page-world **可以调通，但本页是 no-op**（见 §12.7）。
- 全局 CTA（`下载提纲` / `返回首页` / `生成全文`）：`pwClickBtnByText(name)`，先按 `innerText.trim()` 精确匹配，再走同样的 `props.onClick`。`下载提纲` smoke 已过。
- 编辑态 CTA（`一键生成` / `一键复制` / `替换原文`）：仍接受同样的调用方式，但在本项目里**不在任何流程上走它们** —— 数据层 handler 已经覆盖所有写场景。

### 12.5 事件对象跨 Xray 的最终方案

尝试过从 content-script 端直接 `wrappedJSObject.onClick({})` 这种短路调用，会因 `{}` 不是 page 的对象触发 `Permission denied to access property "defaultPrevented"` / `Symbol.toStringTag`。`cloneInto(obj, window.wrappedJSObject, {cloneFunctions:true})` 理论可用，但我们发现更简单：既然 payload 已经在 page-world 跑了，事件对象在 page-world 里构造就完全合法，无需 cloneInto。`cloneInto` 在本项目里**未采用**。

### 12.6 已废弃 / 保留

- `beginEdit` / `isEditorOpen` / `await-edit-close` / 半自动轮询：bridge 与 CLI 均已删除。
- `ICON_FP` 图标指纹表：计划阶段曾预定做 hover 按钮组 SVG path.d 指纹识别 → 因发现 Z handlers 直达数据层，该计划取消，bridge 里没有这个常量表。
- `__unveil()` / `__dismissUnveil()` 调试开关保留，供将来真要点 hover 按钮时手动用。

### 12.7 expand / collapse 是真正的 no-op（应用层限制）

本页 rc-tree 根组件的 props（在 fiber depth 23 处观测）包含 `expandedKeys`（22 项）但 **没有 `onExpand` 回调**：

```
allKeys: ['selectable','showIcon','draggable','onDrop','expandedKeys','dropIndicatorRender','treeData',
  'className','prefixCls','showLine','multiple','checkable','disabled','checkStrictly',
  'defaultExpandParent','autoExpandParent','defaultExpandAll','defaultExpandedKeys',
  'defaultCheckedKeys','defaultSelectedKeys','allowDrop','expandAction']
funcKeys: ['onDrop','dropIndicatorRender','allowDrop']
```

switcher 的 onClick 源码（unminified 片段）：

```js
function (t) {
  var n = e.props, r = n.loading, o = n.context.onNodeExpand;
  r || o(t, tP(e.props));
}
```

在 page-world 里调用完全正常（`err === null`），但 switcher `className` 在 300ms 后仍是 `rc-tree-switcher_open` / `rc-tree-switcher_close` 不变。结论：**应用把 rc-tree 做成了受控但不监听用户 expand 意图**，节点展开状态由新增 / 删除 / 初始化逻辑单独维护。所以**程序化点击 switcher 在本页永远无可视效果**。

bridge v0.7.1 把这个事实写进 `expand` / `collapse`：点完 switcher 后再扫一次状态，若未改变返 `E_NOT_SUPPORTED_BY_PAGE` 并附 message。

**实用影响很小**：

- 用 `addChild` / `addSibling` 加节点时，上游数据层会把新节点自动加入 `expandedKeys`。
- 唯一真正受影响的用例：让已有的某一大段折叠起来做精简视图 —— 该场景没有对应的数据层出口，本工具无法完成。
