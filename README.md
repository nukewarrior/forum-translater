# 论坛译读 · Forum Translator

> Reddit 与 X/Twitter 的逐段中文翻译脚本。支持 Google、Microsoft 和多个自定义 AI Profile，兼容 OpenAI Responses API 与 Chat Completions API。

**版本：0.3.6（Reddit / X 设置独立）** · MIT License · 基于 [sunbigfly/forum-translater](https://github.com/sunbigfly/forum-translater) 定制

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 使用本仓库通过验证的 `dist/forum-translator.user.js` 发布版替换原来的脚本；正式发布之前不要安装尚未测试的开发分支。
3. 打开 Reddit 或 X/Twitter，从 Tampermonkey 菜单打开「翻译设置」。
4. 默认只有一个 Google 翻译 Profile；在「翻译配置」中可添加 Microsoft 或自定义 AI Profile。

本 fork 为覆盖升级，保留原脚本的 `@name` 和 `@namespace` 以沿用 Tampermonkey 脚本身份。**请勿同时启用上游版和本 fork**，以免重复翻译。

## 多 Profile

- 可新建、重命名、复制、编辑和删除 Profile；至少保留一个 Profile。
- 选择 Google / Microsoft / 自定义 AI 三种翻译类型。没有特定 AI 服务商模板。
- AI Profile 独立配置 API Base URL、API Key（可选）、模型、协议、额外提示词、RPM、TPM、思考深度与 Fast 模式。
- API 协议明确选择 `Responses` 或 `Chat Completions`，请求端点自动拼接。
- 支持通过 `/models` 读取列表和手动输入模型 ID；模型列表不可用时不影响手动填写。
- 可以发送真实、可能产生少量费用的测试翻译请求。
- Tampermonkey 菜单直接列出当前可切换的 Profile。
- Reddit 与 X 的设置、Profile 列表、当前选择、API Key 存储及缓存分别隔离；修改或删除一站的 Profile 不影响另一站。X 与 Twitter 共用 X 配置，Reddit 各受支持子域共用 Reddit 配置。**当前标签页切换立即生效**，同站其他已经打开的标签页在刷新或站内路由导航时才读取新 Profile。
- 切换时取消旧请求、立即移除旧译文，并按新 Profile 的独立缓存或实际接口重新翻译。
- API 故障、429 或余额不足时提示错误，不自动切换到其他 Profile。

### 自定义 AI 连接方式

| 字段 | 规则 |
| --- | --- |
| Base URL | `https://api.example.com/v1` 或 `https://api.deepseek.com` 等服务提供商的 Base URL；不包含 `/responses` 或 `/chat/completions` |
| 安全限制 | 只接受 HTTPS，或 `localhost`、`127.0.0.1`、`[::1]` 上的 HTTP |
| API Key | 可留空；空值不发送 `Authorization` 请求头 |
| 模型 | 自动获取或直接输入 |
| 协议 | 每个 Profile 独立选择 Responses / Chat Completions |
| 提示词 | 内置稳定翻译规则 + Profile 独立补充偏好 |
| 思考 / Fast | 仅在显式启用时发送相应兼容参数；服务商是否支持以实际响应为准 |

优先使用流式输出。服务端明确拒绝流式请求且尚未输出有效正文时，允许尝试一次非流式请求；不因网络超时、部分流式输出等不确定状态盲目重发。

## 保留的阅读能力

- Reddit 帖子详情/搜索标题、正文、评论，X 推文、回复、引用及长帖逐段翻译。
- Reddit 首页和板块信息流的帖子标题可在「翻译范围」单独开启（默认关闭）；中英双语上下排列，译文保留帖子链接，并复用现有可视区调度、缓存与「只显示译文」模式。
- 保留原文、链接、代码、受保护的占位符及段落结构。
- 译文在原文下方显示；提供多种样式、仅显示译文、分类翻译开关。
- 视口内容优先、批量 AI 调度、预加载、并发限制、缓存和失败重试。
- 保留字体设置、本机字体检索与预览；字体与显示设置不跟随 Profile 切换。
- X 保留原生导航、右栏、搜索、广告、帖子详情、展开控件与媒体布局；只添加译文和必要的翻译控制。
- 保留 Reddit 的媒体缩放和页面布局优化。
- 保留当前页面的翻译性能统计。

**不再包含**单词本、词典、词汇提取、收藏、复习及高级单词高亮。相关的额外 AI 请求和打包词典资源均已从此 fork 移除。

## 升级、存储与隐私

- 每个站点首次使用隔离版本时，将旧共享设置和多 Profile 数据复制到本站存储，之后仅修改本站数据；已有本站配置不会被覆盖。多 Profile 之前的单服务 AI 配置仍不迁移，无可用 Profile 时默认使用 Google 翻译。
- 字体与译文显示设置继续保留；旧 X 布局偏好不再生效，不影响翻译 Profile 与缓存。
- 保留旧共享数据供回退；不再自动清理历史单词本和词汇数据。旧共享译文缓存不迁移，两站分别按需建立缓存。
- 升级后刷新 Reddit 和 X 已打开的页面，停止旧脚本继续写入共享数据。旧共享开关值会原样保留：若此前关闭 X 时连带关闭 Reddit，请在 Reddit 单独开启一次，之后互不影响。
- 每个 Profile 有独立 ID 和配置版本号，译文缓存按站点及 Profile 隔离。重命名不使缓存失效，修改关键翻译参数会使旧缓存无法命中。
- 配置及密钥仅保存在当前 Tampermonkey 环境中，无跨设备同步、导入导出或云端备份。
- Tampermonkey 存储不是加密保险箱。脚本会把待译文字发送给你选中的翻译服务，可能产生服务费用。
- 只支持 `Reddit` 和 `X/Twitter` 指定页面，不自动在其他网站执行。

## 开发与验证

源代码在 `src/`，测试在 `tests/`；生成脚本为 `dist/forum-translator.user.js`。

```bash
npm ci
npm run verify
```

验证包含 TypeScript 类型检查、esbuild 打包、Vitest 与发布产物审计。开发分支的 CI 状态见仓库 Actions。发布版必须先完成构建和实机验证。

### 许可证与致谢

保留原作者 [sunbigfly](https://github.com/sunbigfly) 的 MIT 授权与第三方声明。详见 [LICENSE](LICENSE)、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
