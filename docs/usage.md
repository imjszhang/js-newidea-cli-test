# 使用指南

`review-cli` 是 `review.newidea.pro` 的多页面自动化 CLI。

当前支持两个页面 profile：

- `outline`：提纲树读写、CTA 点击、节点级视觉反馈
- `home`：主题输入、生成模式选择、主按钮触发与跳转验证

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

## 快速开始

```bash
node review-cli.js doctor
node review-cli.js probe
node review-cli.js state

node review-cli.js doctor --page home
node review-cli.js probe --page home
node review-cli.js state --page home
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
- `-v, --verbose`

## 视觉反馈

CLI 默认开启页面内视觉反馈：

- `outline` 侧重节点定位、执行、完成态提示
- `home` 侧重按钮、输入和跳转过程提示
- 支持 `compact` 与 `staged` 两种粒度
- 使用 `pointer-events: none`，不会抢占页面交互

## 已知限制

- bridge 按页面 profile 注入：`outline-bridge.js` 只适用于 `/outline`，`home-bridge.js` 只适用于 `/home`
- `/outline` 中 `expand` / `collapse` 在当前站点通常是 no-op
- `/outline` 中 `select` 只是视觉反馈，没有真实选中态
- `/home` 中 `生成提纲` 需要主题文本
- `/home` 中不同模式的页面响应时延不同，`long` 通常更慢
- 破坏性操作如 `生成全文`、`返回首页` 需要 `--confirm`
