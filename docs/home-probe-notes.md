# Home Probe Notes — `review.newidea.pro/home`

本文件记录 `/home` 页面的已验证侦察结论，供 `home-bridge.js` 与 `review-cli.js` 后续维护时参考。

它关注的是首页入口控件、生成模式、主题输入和主按钮的可观测结果，不覆盖 `/outline` 的树结构侦察。

## 1. 页面目标

`/home` 页当前主要承载三类动作：

- 填写综述主题
- 选择生成模式
- 触发主按钮：
  - `继续编辑本地文档`
  - `生成提纲`

和 `/outline` 相比，这一页不需要 path 模型，重点在于“如何稳定找到控件”和“点击后如何确认动作真的发生了”。

## 2. 页面指纹

稳定可见的页面特征：

- `location.pathname === "/home"`
- `document.title === "综述写作工作台"`
- 页面存在一个主题输入 `textarea`
- 页面存在三张生成模式卡片：`短篇 / 中篇 / 长篇`
- 页面存在两个主按钮：`继续编辑本地文档 / 生成提纲`

bridge 中的 `probe()` / `state()` 会输出：

- `url`
- `title`
- `topicValue`
- `topicLength`
- `generateModes`
- `primaryActions`

## 3. 主题输入框

当前 bridge 采用最轻量的定位方式：

- `document.querySelector("textarea")`

写入方式：

1. 调用原生 `HTMLTextAreaElement.value` setter
2. 派发 `input`
3. 派发 `change`

这对当前页面足够稳定，`setTopic(text)` 依赖的就是这套路径。

验证结果：

- `topicValue` 会返回摘要文本
- `topicLength` 会返回原始长度
- `生成提纲` 在没有主题时会返回 `E_BAD_ARG`

## 4. 生成模式卡片

页面上的三张模式卡片目前表现稳定：

- 固定顺序：`short / medium / long`
- 文案对应：`短篇 / 中篇 / 长篇`
- 选中态通过样式判断，而不是 aria 或 radio 语义

bridge 当前使用的识别策略：

- 通过 class 中包含
  - `w-[10.625rem]`
  - `h-[5.75rem]`
  来识别三张模式卡片
- 选中态通过 class 中是否包含以下特征判断：
  - `border-primary`
  - `bg-gradient-to-b`
  - `from-[#FFF9EA]`

`setMode(mode)` 的实际行为：

1. 找到目标卡片
2. 调用 `target.click()`
3. 短轮询当前选中模式，等待选中态切换完成

当前支持的模式输入：

- `short | medium | long`
- `短篇 | 中篇 | 长篇`
- `mid | middle` 也会归并到 `medium`

## 5. 主按钮定位

当前主按钮是通过文本精确匹配定位的：

- `继续编辑本地文档`
- `生成提纲`

定位方式：

- 扫描页面中的 `button`
- 用 `innerText.trim()` 与目标文本做精确匹配
- 同时要求按钮可见

返回结构会暴露：

- `visible`
- `disabled`

## 6. 主按钮行为与验证信号

### 6.1 `继续编辑本地文档`

直接 DOM 层面没有可靠的 URL 变化。

当前最稳定的验证信号是浏览器级事件：

- `filechooser`

也就是说，这个按钮是否“生效”，不能只看页面跳没跳，而要监听浏览器层是否真的打开了文件选择器。

### 6.2 `生成提纲`

这个按钮有两个关键前置条件：

1. 必须有主题文本
2. 可选地先设置生成模式

当前最稳定的成功信号是：

- 从 `/home` 跳转到 `/outline`

bridge 会记录：

- `beforeUrl / afterUrl`
- `beforePath / afterPath`
- `urlChanged / pathChanged / titleChanged`
- `mode / modeLabel`
- `topicValue`

## 7. 点击策略

`home` 页按钮目前不能只靠单一路径调用。

bridge 中实际采用的策略是：

- `生成提纲`
  - 优先走原生 `button.click()`
- 其他主按钮
  - 优先走 React `onClick`
  - 若拿不到 handler，再回退到原生 `click()`

原因是两条路径在页面上的稳定性并不完全相同：

- `生成提纲` 更接近真实用户点击路径
- `继续编辑本地文档` 在 React handler 路径下更容易稳定触发 `filechooser`

## 8. 等待策略

`生成提纲` 的页面响应时延与生成模式相关。

当前 bridge 的轮询等待按模式分层：

- `short`：40 次检查
- `medium`：80 次检查
- `long`：140 次检查

每次检查间隔：

- `150ms`

这样做的原因是：

- `long` 模式明显比 `short` 更慢
- 若等待太短，会把已触发但未完成跳转的动作误判为失败

## 9. session 层补强

`home` 页点击调用除了桥本身的返回值，还会由 `session` 层额外监听浏览器级事件：

- `popup`
- `contextPage`
- `dialog`
- `filechooser`
- `download`

如果页面跳转导致：

- `Execution context was destroyed`

`session` 会尝试基于当前 page URL 做后验恢复，而不是直接把命令打成失败。

这对 `生成提纲` 这种“触发后立刻导航”的动作很关键。

## 10. 当前稳定 API

`home-bridge.js` 当前对外暴露：

- `version()`
- `probe()`
- `state()`
- `setVisualOptions()`
- `setMode(mode)`
- `setTopic(text)`
- `clickPrimary(action, options?)`

其中 `clickPrimary()` 目前稳定覆盖：

- `继续编辑本地文档`
- `生成提纲`

并支持附加：

- `topic`
- `mode`

## 11. 已知限制

- 主题输入框目前通过 `querySelector("textarea")` 获取，若页面未来出现多个 textarea，需要改成更明确的定位
- 模式卡片当前依赖 class 特征和固定顺序，若样式系统大改，需要重新侦察
- `继续编辑本地文档` 的强验证依赖 `filechooser`，如果产品改成弹窗或新页，验证策略也要更新
- `生成提纲` 的成功判定目前主要依赖跳转到 `/outline`，若未来改成站内异步加载同页流转，需要补充新的可观测信号

## 12. 相关文件

- `home-bridge.js`
- `lib/session.js`
- `lib/drivers/playwright.js`
- `docs/usage.md`
- `docs/development.md`
