# review-cli 多页面桥接工具

> `review-cli` 用于把 `review.newidea.pro` 的多个工作台页面接入可插拔浏览器驱动。
> 当前已支持 `https://review.newidea.pro/outline`、`https://review.newidea.pro/home` 和 `https://review.newidea.pro/proofread` 三个页面 profile。

## 项目定位

- 在真实浏览器会话上远程执行页面内操作
- 把页面特有 DOM / React 逻辑收敛到各自 bridge
- 通过统一 CLI 暴露命令，并用 `--page` 切换目标页面
- 在执行过程中提供低侵入视觉反馈，便于旁观和验证

## 项目结构

- `review-cli.js`：CLI 主入口
- `outline-bridge.js`：`/outline` 页 bridge
- `home-bridge.js`：`/home` 页 bridge
- `proofread-bridge.js`：`/proofread` 页 bridge（支持编辑态 / AI 改写面板识别）
- `lib/`：配置、命令、session 与 driver 实现
- `docs/usage.md`：面向使用者的命令说明与示例
- `docs/development.md`：面向维护者的结构说明
- `docs/outline-probe-notes.md`：`/outline` 深度侦察笔记

## 页面 profile

- `outline`
  - 路由：`/outline`
  - bridge：`outline-bridge.js`
  - 全局对象：`window.__jse_outline__`
- `home`
  - 路由：`/home`
  - bridge：`home-bridge.js`
  - 全局对象：`window.__jse_home__`
- `proofread`
  - 路由：`/proofread`
  - bridge：`proofread-bridge.js`
  - 全局对象：`window.__jse_proofread__`

默认页面来自 `REVIEW_PAGE`，也可以通过 `--page` 显式指定。

## 快速开始

```bash
node review-cli.js doctor
node review-cli.js probe
node review-cli.js state

node review-cli.js doctor --page home
node review-cli.js probe --page home
node review-cli.js probe --page proofread
```

完整命令、环境变量、页面说明与限制请看：

- [使用指南](docs/usage.md)
- [开发说明](docs/development.md)
- [Home 侦察笔记](docs/home-probe-notes.md)
- [Outline 侦察笔记](docs/outline-probe-notes.md)
- [Proofread 侦察笔记](docs/proofread-probe-notes.md)

## 常见入口

```bash
node review-cli.js --help
node review-cli.js tree
node review-cli.js probe --page home
node review-cli.js primary "生成提纲" "测试主题" --page home --mode long
node review-cli.js state --page proofread
node review-cli.js select-section 3 --page proofread
node review-cli.js rewrite-prompt "保持学术语气" --page proofread
```

## 备注

- 对外命令统一为 `review-cli`
- 默认 driver 为 `playwright`
- `jseyes` 仍作为兼容 driver 保留
