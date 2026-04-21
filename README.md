# outline-bridge + outline-cli

> 本目录是一套"把 `https://review.newidea.pro/outline` 操作面板接入可插拔浏览器驱动"的工具。
> **全自动写操作**：rename / editBody / addChild / addSibling / remove / expand / collapse / clickCta 全部落地，无需用户在真实浏览器里再手动点一次。

- `outline-bridge.js` —— 注入到页面里、挂在 `window.__jse_outline__` 的桥接脚本。v0.7.1。
- `outline-cli.js`    —— 本地 Node CLI，瘦入口；默认通过 `playwright` 连接浏览器，也支持 `js-eyes` 兼容模式。
- `lib/`             —— driver / session / CLI 解析逻辑。`bridge` 保持页内职责，transport 抽成可替换模块。
- `_probe-notes.md`   —— 全部侦察笔记（**推荐先读 §12 Xray 根因与 Z handlers 通道**；§7 / §8 / §9 / §9b 已推翻，仅作溯源）。
- `package.json`      —— `bin: outline-cli`，依赖 `playwright` + `@js-eyes/client-sdk`。

v0.7.0 与 v0.6.x 的本质区别：

- 旧版以为限制来自 `isTrusted` —— 实际是 Firefox content-script 的 **Xray 屏障**。
- 新版通过 `<script>` 注入把 payload 跑在页面 principal，就能读 `__reactFiber$` / `__reactProps$`，直接调 React handler。
- 写操作不走 Slate 编辑器、不依赖 "替换原文"；改走 rc-tree 节点组件（代号 `Z`）暴露的 4 个数据层 handler：`onEditNode` / `onAddChildNode` / `onAddSibNode` / `onDeleteNodes`。

---

## 快速上手

### 默认路径：Playwright + Chromium CDP

前置：

- Chrome / Edge 已用远程调试端口启动，例如：
  - Windows: `msedge --remote-debugging-port=9222`
  - Windows: `chrome --remote-debugging-port=9222`
- 浏览器中已经登录并打开 `https://review.newidea.pro/outline`
- 本仓根目录执行过 `npm install`

如需改 CDP 地址，可设 `OUTLINE_CDP_ENDPOINT=http://127.0.0.1:9222`。

```bash
cd work_dir

node outline-cli.js doctor                        # 连通性 + 注入 + probe + state 汇总
node outline-cli.js tree                          # 打印提纲（缩进文本）
node outline-cli.js tree --json                   # 原始结构
node outline-cli.js find "突触"                    # 按 contains 查找

node outline-cli.js select 0.2.1                  # 默认显示 HUD + 节点高亮
node outline-cli.js select 0.2.1 --no-visual      # 如需静默执行可关闭可视反馈
node outline-cli.js expand 0.2 --deep             # 递归展开子树
node outline-cli.js collapse 0.2

node outline-cli.js rename 0.2.0.0 "新要点文本"     # 一步到位，无需浏览器再点
node outline-cli.js rename 0.2.0.0 "新要点文本" --visual-ms 700
node outline-cli.js add-child 0.2 "新子要点"
node outline-cli.js add-after 0.2.0 "新同级要点"
node outline-cli.js remove 0.2.0.0

node outline-cli.js cta 下载提纲                   # 直接触发下载对话框
node outline-cli.js cta 生成全文 --confirm         # 破坏性：会离开 /outline，必须 --confirm
node outline-cli.js cta 返回首页 --confirm         # 破坏性：必须 --confirm
```

### 兼容路径：js-eyes

如果你仍想沿用旧链路：

- Firefox 已装 js-eyes 扩展
- 已登录 `review.newidea.pro/outline`
- `js-eyes server` 运行在 `ws://localhost:18080`

调用时显式指定：

```bash
node outline-cli.js doctor --driver jseyes
node outline-cli.js tree --driver jseyes
```

## 节点身份：path 制

节点用 `"a.b.c"` 形式的 path 标识，路径即从根到目标的每级兄弟序号（零基），无持久化、每次读都从 DOM 重推。示例：

```text
0           根（文章标题）
0.0         第 1 个 section（摘要：）
0.0.0       摘要段落正文
0.2         第 3 个 section（1. 星形胶质…）
0.2.0       1.1 代谢型谷氨酸受体与嘌呤能受体
0.2.0.0     1.1 下的第 1 条 "-" 要点
```

`find` 支持：`find <kw>`（contains 匹配）。需要更细的匹配可以 `--json` 后自己过滤。

> **path 易变**：增删兄弟节点会重新编号。长流程别缓存 path，每步都重新 `find` / `tree`。

## Bridge API 速查（`window.__jse_outline__`）

返回一律 `{ok:true, data:<T>}` 或 `{ok:false, code, message}`；bridge 本身返 JSON 字符串，CLI 侧 parse。

| 方法 | 说明 |
| --- | --- |
| `version()` | 当前桥接版本 |
| `probe()` | URL / 节点总数 / editorOpen / xrayAvailable / 全局 CTA 可见性 |
| `tree()` | 扁平化节点数组 `[{path, depth, text, switcher}, ...]` |
| `get(path)` | 单节点信息 |
| `find({text?, contains?, depth?})` | 过滤；CLI 入参退化为 `{contains}` |
| `state()` | URL / scrollY / editorOpen / editorCtas / globalCtas |
| `nodeKey(path)` | 返回节点的 React `key` + `title` + 子节点数（调试 / 内部） |
| `scrollIntoView(path)` | 仅滚动 |
| `select(path)` | 滚动 + 红框闪 600ms（rc-tree `selectable=false`，无真选中态） |
| `expand(path)` | 调 switcher.onClick；**本页 rc-tree 受控且无 onExpand 回调**，所以实际是 no-op 并返 `E_NOT_SUPPORTED_BY_PAGE`（见"已知限制 §3"） |
| `collapse(path)` | 同上 |
| `rename(path, text)` | `Z.onEditNode` 改 `item.title`，返回 `{before, after}` |
| `editBody(path, text)` | 与 `rename` 等价（本页节点无标题/正文之分） |
| `addChild(path, text?)` | `Z.onEditNode` 在父节点 children 末尾追加一个新节点；返回 `{childPath, childKey, verified}` |
| `addSibling(path, text?, {where})` | 在父节点 children 数组里按 `before/after` 插入；返 `{newPath, newKey}` |
| `remove(path)` | `Z.onDeleteNodes([key])` 删除，无 AlertDialog |
| `clickCta(name)` | 按 `innerText` 匹配全局或编辑态 CTA，调 `props.onClick` |
| `__unveil()` / `__dismissUnveil()` | 调试用：临时 CSS 强显悬停按钮组（生产不用） |

错误码：

| code | 含义 |
| --- | --- |
| `E_BAD_ARG` | path 格式 / CTA 名称 / where 值非法 |
| `E_NOT_FOUND` | path 在 DOM 中找不到 / 按钮不可见 |
| `E_UI_MISMATCH` | DOM 结构偏离预期（tree 根没找到、switcher 缺失等） |
| `E_FIBER` | fiber 链上没找到 Z 组件，或 page-world 调用报异常 |
| `E_DISABLED` | 按钮存在但 `disabled=true`（如 `替换原文` 无 AI 输出时） |
| `E_TIMEOUT` | page-world 未在 3s 内回写结果 |
| `E_PARSE` | page-world 写回的不是合法 JSON（理论不应发生） |
| `E_XRAY` | 读 `window.__JSE_OUTLINE_RET__` 抛跨 realm 异常 |
| `E_INSTALL` | bridge 注入失败 |

## CLI 速查

```text
outline-cli doctor                        连通性 + 注入 + probe + state
outline-cli tree [--json]                 打印提纲
outline-cli find "<kw>"                   节点文本 contains 查找
outline-cli select <path>                 滚动 + 闪烁
outline-cli scroll-to <path>              仅滚动
outline-cli expand <path> [--deep]        展开 / 递归展开
outline-cli collapse <path>               折叠
outline-cli state                         运行态
outline-cli probe                         页面指纹
outline-cli node-key <path>               调试：查节点 React key

outline-cli rename <path> "文本"          改节点标题
outline-cli edit   <path> "文本"          同 rename（语义保留）
outline-cli add-child <path> ["文本"]     父节点下追加子节点
outline-cli add-after <path> ["文本"]     加后兄弟
outline-cli add-before <path> ["文本"]    加前兄弟
outline-cli remove <path>                 删除节点

outline-cli cta <name>                    点击全局或编辑态 CTA
outline-cli cta 生成全文 --confirm        必须显式 --confirm
outline-cli cta 返回首页 --confirm        必须显式 --confirm
```

公共 option：

- `--tab <id>`：跳过自动发现，指定 tab id
- `--driver <name>`：选择 `playwright` 或 `jseyes`；默认 `playwright`
- `--json`：结构化输出（`tree` / `find` / 写命令调试）
- `--deep`：`expand` 递归
- `--confirm`：仅破坏性 `cta`（`生成全文` / `返回首页`）需要
- `--visual`：显式开启页面内视觉反馈（默认已开启）
- `--no-visual`：关闭页面内视觉反馈
- `--visual-ms <n>`：控制可视反馈持续时长（毫秒）
- `-v, --verbose`：打印连接 / 注入细节
- 退出码：bridge `ok:false` → `1`；连接/注入/参数等 CLI 错误 → `2` 或 `3`。

## DOM 可视反馈

为便于旁观自动化过程，CLI 现在默认开启页面内视觉提示：

- 节点类操作会在目标节点上显示临时高亮和动作标签
- `add-child` / `add-after` / `add-before` 成功后会重新定位并高亮新增节点
- `remove` 会先提示即将删除的节点，再用右上角 HUD 显示完成状态
- `cta` 会高亮按钮本身，避免用户只看到页面突然变化

示例：

```bash
node outline-cli.js select 0.2.1
node outline-cli.js rename 0.2.0.0 "改后的文本" --visual-ms 650
node outline-cli.js add-child 0.2 "新增子要点"
node outline-cli.js cta 下载提纲
node outline-cli.js tree --no-visual
```

说明：

- 视觉提示默认开启；如需静默执行可显式加 `--no-visual`
- 提示层使用 `pointer-events: none`，不会抢占页面点击
- 写操作若触发 React 重渲染，bridge 会在操作后重新定位目标节点再显示完成态

## 典型流水线示例

```bash
# 1. 看看现在是什么样
node outline-cli.js doctor

# 2. 找一个节点，改它的标题
node outline-cli.js find "关键词"
node outline-cli.js rename 0.0.1 "关键词：AstroGPCR; 突触调节; 胶质-神经元互作"

# 3. 给 1.1 节加两个子要点
node outline-cli.js add-child 0.2.0 "- G_i/o 型 mGluR 的内化机制"
node outline-cli.js add-child 0.2.0 "- A1R-A2AR 异二聚体的信号偏向性"

# 4. 结构错了？删掉重来
node outline-cli.js remove 0.2.0.5

# 5. 导出
node outline-cli.js cta 下载提纲
```

## 已知限制（v0.7.1 真实清单）

1. **`生成全文` / `返回首页` 后离开 `/outline`**：SPA 路由切走后本 bridge 不再适用；CLI 用 `--confirm` 软拦截避免误伤。其他 CTA（`下载提纲` / 编辑态三件套）无破坏性。
2. **只在 `/outline` 工作**：其他页面 DOM 结构不同，bridge 注入后 `probe().onOutlinePage=false`，所有 API 会返 `E_UI_MISMATCH`。
3. **`expand` / `collapse` 在本页是 no-op**：rc-tree 是受控模式（`expandedKeys` 传入但没有 `onExpand` 回调），switcher onClick 的内部逻辑走 `context.onNodeExpand`，但该回调在页面上不会更新 `expandedKeys`。bridge 检测到状态未变后返 `E_NOT_SUPPORTED_BY_PAGE`。**替代手段**：增删节点时 `onEditNode` / `onAddChildNode` 会自动把新节点加入展开集合，所以业务流程里并不需要手动展开。
4. **`select` 只是视觉反馈**：rc-tree 本页 `selectable=false`，DOM 没有真正的选中态。
5. **page-world 调用有 3s 超时**：`runInPage` 硬编码 3000ms，正常写操作远低于此；若 React 重渲异常长可能触发 `E_TIMEOUT`。
6. **path 随增删变化**：写操作串联时每步重新 `find` / `tree`，别缓存。

## Driver 架构

当前实现拆成两层：

- `outline-bridge.js`：只负责页内 DOM / React / CTA 逻辑。
- `lib/session.js` + `lib/drivers/*`：负责目标页发现、脚本执行、bridge 注入和 CLI 编排。

默认 driver：

- `playwright`：通过 Chromium CDP 附着到现有浏览器会话，适合脱离 `js-eyes` 使用。

兼容 driver：

- `jseyes`：保留原先的 Firefox + 扩展 + 本地 server 路径。

## 内部实现说明

- 桥接以 IIFE 表达式被驱动层 `evaluate`，末尾 `return JSON.stringify({...})`；CLI 侧自动 parse。
- CLI 每次命令都会 `ensureBridge()`：读 `outline-bridge.js` 里 `const VERSION = '0.7.1'` 和页面里 `window.__jse_outline__.__meta.version` 比对，不一致即重注。改代码 + bump 版本即热更。
- 所有写操作走统一的 page-world 通道：
  1. 在目标元素上 `setAttribute('data-jse-op', token)`。
  2. `<script>` 注入 payload，payload 里 `document.querySelector('[data-jse-op="…"]')` 找回元素 → 拿 `__reactFiber$` → 沿 `.return` 最多 40 层找首个同时带 `onEditNode` 和 `item` 的 fiber（即 `Z` 组件）。
  3. 调 handler，`window.__JSE_OUTLINE_RET__ = JSON.stringify(result)`。
  4. 驱动执行上下文取回 `window.__JSE_OUTLINE_RET__`，parse 后返回。
  5. finally 里 `removeAttribute('data-jse-op')`。
- CTA / switcher 走同样的 page-world 通道，区别是直接拿 `__reactProps$.onClick` 而不需要爬 fiber 链。
- `unwrap(x)` = `x.wrappedJSObject ?? x`；Chrome 下没有 `wrappedJSObject`，天然回落为 `x`，跨浏览器兼容。

## 开发与迭代

- 改 `outline-bridge.js` 前把 `VERSION` 常量 bump 一下（CLI 用它判断是否需要重注入）。
- 有 DOM 侦察需求就在任意临时目录写 `_probe-*.js`，通过 `executeScript` 跑，稳定结论沉到 `_probe-notes.md` §12 或之后。
- 如果 Slate / rc-tree / Plate 升版，核心断点是：
  - Z 组件向上链深度：在 `pwFindZ` 里把 40 改大。
  - Z 组件判据：`'onEditNode' in mp && 'item' in mp`，若 prop 重命名则在这里改。
  - 新节点 key 命名：`'id-jse-' + random`，生产页似乎用 `'id-xxx'` 风格，只要不跟页面已有 key 撞就不影响。
