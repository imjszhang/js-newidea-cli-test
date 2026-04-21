# 开发说明

这份文档面向维护 `review-cli` 的开发者，聚焦结构分层、bridge 责任边界和后续扩展方式。

## 结构分层

- `review-cli.js`
  - CLI 主入口
  - 调用 `lib/cli.js` 的 `main()`
- `lib/commands.js`
  - 定义命令、帮助信息与参数解析
- `lib/cli.js`
  - 校验命令参数
  - 选择 page profile
  - 创建 driver / session
  - 分发命令并处理返回码
- `lib/config.js`
  - 默认 driver / page / endpoint
  - page profile 定义
- `lib/session.js`
  - resolve target
  - ensure bridge
  - 调用 page API
  - 补强页面事件与导航恢复
- `lib/drivers/*`
  - `playwright`：Chromium CDP
  - `jseyes`：历史 Firefox 扩展链路
- `outline-bridge.js`
  - `/outline` 页 bridge
  - 节点树读写、CTA、视觉反馈
- `home-bridge.js`
  - `/home` 页 bridge
  - 主题、模式、主按钮、跳转验证

## page profile 约定

`lib/config.js` 中每个 profile 需要定义：

- `name`
- `targetUrlFragment`
- `bridgePath`
- `bridgeGlobal`
- `routeLabel`

新增页面时，推荐顺序：

1. 在 `lib/config.js` 增加新 profile
2. 新建专属 bridge
3. 在 `lib/commands.js` 把命令与 profile 关联起来
4. 在 `README.md` 和 `docs/usage.md` 补充说明

## bridge 设计边界

bridge 只做“页面内真实逻辑”：

- DOM 定位
- React props / fiber 读取
- 页面态验证
- 页面内视觉反馈

CLI / session / driver 负责：

- 浏览器连接
- 目标页发现
- bridge 注入与版本校验
- 命令编排
- 错误码与进程退出码

## `/outline` 与 `/home` 的差异

### `/outline`

- 以节点树为中心
- 命令围绕 path 展开
- 主要涉及 `tree / find / rename / add-child / add-after / remove / cta`
- 深度侦察笔记保存在 `docs/outline-probe-notes.md`

### `/home`

- 以首页控件为中心
- 不使用 path 模型
- 主要涉及 `topic / mode / primary`
- 验证不只看 DOM，还结合浏览器级事件，如 `filechooser`

## 视觉反馈约定

当前两套 bridge 都支持：

- `enabled`
- `durationMs`
- `detailLevel`

其中：

- `compact`：更短更轻
- `staged`：更适合旁观执行过程

原则：

- 默认开启
- 不影响原页面交互
- 尽量在目标元素附近表达“定位 / 执行 / 响应 / 验证”

## 版本与热更新

每个 bridge 文件都维护自己的 `VERSION`。

`session.ensureBridge()` 会：

1. 读取本地 bridge 里的 `VERSION`
2. 读取页面中已注入 bridge 的 `__meta.version`
3. 不一致时重新注入

因此修改 bridge 代码后要记得 bump 对应 `VERSION`。

## 导航与验证

`home` 页命令比 `outline` 更依赖“动作已发生”的后验验证：

- `继续编辑本地文档`：观察 `filechooser`
- `生成提纲`：观察是否跳转到 `/outline`
- 若页面导航导致执行上下文销毁，`session` 会尽量做恢复判断

## 侦察资料

- 用户文档：`README.md`、`docs/usage.md`
- 开发说明：`docs/development.md`
- `/home` 深度侦察：`docs/home-probe-notes.md`
- `/outline` 深度侦察：`docs/outline-probe-notes.md`
