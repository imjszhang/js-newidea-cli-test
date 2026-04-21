# 使用指南

`review-cli` 是 `review.newidea.pro` 的多页面自动化 CLI。

当前支持三个页面 profile：

- `outline`：提纲树读写、CTA 点击、节点级视觉反馈
- `home`：主题输入、生成模式选择、主按钮触发与跳转验证
- `proofread`：初稿校对页侦察与局部编辑辅助（段落卡片、编辑态、AI 改写面板）

## 前置条件

- 已执行 `npm install`
- 浏览器已登录目标站点
- Chrome / Edge 已开启远程调试端口，例如：
  - `msedge --remote-debugging-port=9222`
  - `chrome --remote-debugging-port=9222`

如需覆盖默认连接地址，可设置：

- `REVIEW_CDP_ENDPOINT`
- `REVIEW_JSEYES_WS_ENDPOINT`
- `REVIEW_DRIVER`
- `REVIEW_PAGE`
- `REVIEW_OUTLINE_TARGET_URL_FRAGMENT`
- `REVIEW_HOME_TARGET_URL_FRAGMENT`
- `REVIEW_PROOFREAD_TARGET_URL_FRAGMENT`

## 快速开始

```bash
node review-cli.js doctor
node review-cli.js probe
node review-cli.js state

node review-cli.js doctor --page home
node review-cli.js probe --page home
node review-cli.js state --page home

node review-cli.js doctor --page proofread
node review-cli.js probe --page proofread
node review-cli.js state --page proofread
```

## `/outline` 常用命令

```bash
node review-cli.js tree
node review-cli.js tree --json
node review-cli.js find "突触"

node review-cli.js select 0.2.1
node review-cli.js expand 0.2 --deep
node review-cli.js collapse 0.2

node review-cli.js rename 0.2.0.0 "新要点文本"
node review-cli.js add-child 0.2 "新子要点"
node review-cli.js add-after 0.2.0 "新同级要点"
node review-cli.js remove 0.2.0.0

node review-cli.js cta 下载提纲
node review-cli.js cta 生成全文 --confirm
node review-cli.js cta 生成全文 --dialog-action cancel --fulltext-lang en
node review-cli.js cta 生成全文 --confirm --fulltext-lang zh --dialog-action confirm
node review-cli.js cta 返回首页 --confirm
```

### path 说明

`/outline` 中节点使用 `a.b.c` 形式的 path 表示从根到目标的兄弟序号路径。

```text
0
0.0
0.2
0.2.0
0.2.0.0
```

注意：

- path 会随增删节点变化
- 多步流程不要缓存旧 path
- 建议每步重新 `find` 或 `tree`

## `/home` 常用命令

```bash
node review-cli.js topic "线粒体自噬与帕金森病中的神经保护机制" --page home
node review-cli.js mode long --page home

node review-cli.js primary "继续编辑本地文档" --page home
node review-cli.js primary "生成提纲" "线粒体自噬与帕金森病中的神经保护机制" --page home
node review-cli.js primary "生成提纲" "线粒体自噬与帕金森病中的神经保护机制" --page home --mode medium
```

说明：

- `topic` 用于写入首页主题输入框
- `mode` 接受 `short | medium | long`，也接受 `短篇 | 中篇 | 长篇`
- `primary "继续编辑本地文档"` 的主要验证信号是 `filechooser`
- `primary "生成提纲"` 需要主题文本，主要验证信号是从 `/home` 跳转到 `/outline`

## `/proofread` 常用命令

```bash
node review-cli.js doctor --page proofread
node review-cli.js probe --page proofread
node review-cli.js state --page proofread
node review-cli.js select-section 3 --page proofread
node review-cli.js rewrite-prompt "保持学术语气，压缩重复表述" --page proofread
node review-cli.js editor-button "AI 改写" --page proofread
```

说明：

- 当前已支持段落选中、编辑态识别和 AI 改写面板辅助
- `probe` 侧重页面识别、顶部 CTA、活动段落和提纲采样
- `state` 侧重当前段落卡片列表、滚动位置、编辑态和按钮状态
- `select-section <paragraphIndex>` 会按 0-based 顺序选中目标段落，并验证该卡片是否切到活动态
- 当前活动态更像瞬时聚焦，高亮不一定在后续独立命令里持续保留
- 若页面已进入编辑态，`state` / `probe` 会额外报告当前编辑段、编辑态按钮和 AI 改写面板状态
- `rewrite-prompt <text>` 用于填写“请输入额外需求”输入框
- `editor-button <name>` 用于点击当前编辑态中的按钮，例如 `确认校对`、`AI 改写`、`一键重写`
- `替换原文` 会先弹出确认框；当前已在真实页面验证，确认后会把改写结果落回原段

## 帮助与选项

完整命令说明以 `node review-cli.js --help` 为准。

常用选项：

- `--page <name>`
- `--tab <id>`
- `--driver <name>`
- `--json`
- `--deep`
- `--confirm`
- `--visual`
- `--no-visual`
- `--visual-detail <compact|staged>`
- `--visual-ms <n>`
- `--mode <mode>`
- `--fulltext-lang <zh|en|中文|English>`
- `--cn-refs <yes|no|是|否>`
- `--dialog-action <confirm|cancel>`
- `-v, --verbose`

## 视觉反馈

CLI 默认开启页面内视觉反馈：

- `outline` 侧重节点定位、执行、完成态提示
- `home` 侧重按钮、输入和跳转过程提示
- 支持 `compact` 与 `staged` 两种粒度
- 使用 `pointer-events: none`，不会抢占页面交互

## 已知限制

- bridge 按页面 profile 注入：`outline-bridge.js` 只适用于 `/outline`，`home-bridge.js` 只适用于 `/home`，`proofread-bridge.js` 只适用于 `/proofread`
- `/outline` 中 `expand` / `collapse` 在当前站点通常是 no-op
- `/outline` 中 `select` 只是视觉反馈，没有真实选中态
- `/home` 中 `生成提纲` 需要主题文本
- `/home` 中不同模式的页面响应时延不同，`long` 通常更慢
- 破坏性操作如 `生成全文`、`返回首页` 需要 `--confirm`
- `/outline` 中 `生成全文` 的确认框存在页面版本差异，部分版本不显示“需要中文文献：是/否”
- `/outline` 中确认“生成全文”后，当前已验证会进入 `/proofread`
- `/proofread` 当前仍未完全打通“如何稳定进入编辑态”的自动化链路；现阶段支持 `doctor / probe / state / select-section / rewrite-prompt / editor-button`
