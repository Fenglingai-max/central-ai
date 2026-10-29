# Central.ai 与 ChatGPT / Codex 的接入范围

> **最新选择**：用户已改为每位用户在自己电脑运行的个人版本，使用本人的官方 Codex ChatGPT 登录。当前实现见 [LOCAL-CODEX.md](LOCAL-CODEX.md)。下文 SIWC 托管网站路线保留作方案记录，不是当前部署。

核验日期：2026-10-30（Asia/Shanghai）。本文按用户最新目标修订：**公开网站，每个用户授权自己的 ChatGPT 账号，使用各自符合资格的计划额度**。

## 结论修订

公开网站并非只能使用开发者 API Key。OpenAI 现在提供 **Sign in with ChatGPT（SIWC）**：在应用和账户符合资格、且用户单独批准 ChatGPT plan usage 权限时，可以用该用户的计划或可用 credits 完成受支持的请求。[官方 Quickstart](https://developers.openai.com/siwc/quickstart)

但 Central.ai 是远程托管网站。官方目前要求付费或远程托管应用先申请接入；选定商业伙伴处于 limited trial。公开一个 GitHub 仓库，不会自动让服务器网站获得本地开源应用的动态注册权限。应申请 SIWC website 客户端和 **ChatGPT plan usage** 权限，取得确认后再开放给用户。[使用范围说明](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt#usage-policy-and-terms)、[Request a client ID](https://developers.openai.com/siwc/request-client-id)

此前“正式公共服务只能用独立 Platform API Key”的表述过宽，现以上述 SIWC 官方路线为准。当前没有提交接入申请，没有收到客户端或 hosted plan-usage 批准，也没有调用模型。

## 三种身份与授权不能混用

| 能力 | 所证明的内容 | 不会自动获得的权限 |
| --- | --- | --- |
| Google 登录 Central.ai | 经服务端验证的 Google 用户身份 | ChatGPT 计划额度或 OpenAI 调用权限 |
| ChatGPT identity-only 登录 | 经 OIDC 验证的 OpenAI 身份 | ChatGPT plan usage；身份 scopes 不含推理授权 |
| SIWC + ChatGPT plan usage | 用户明确授予的受支持推理权限 | 所有 ChatGPT 功能、无限额度、任意模型或视频供应商额度 |

身份 scopes 为 `openid profile email`。计划使用需要额外授权，不能只看到登录成功或有效 ID token 就显示“使用订阅额度”。符合资格的 Plus / Pro 是官方当前明确列出的用户范围，仍受应用资格、账户政策及实际返回权限约束。[Quickstart](https://developers.openai.com/siwc/quickstart)

## 为什么不把个人 Codex 认证搬到服务器

官方 app-server 文档已明确：旧 app-server authentication 不适用于 commercial 或 hosted 服务；这些场景应使用 SIWC。Central.ai 不复制开发者或用户的 `auth.json`、浏览器 Cookie 或桌面会话来供公网调用。[App-server auth endpoints](https://learn.chatgpt.com/docs/app-server#auth-endpoints)

个人、本机、可信的 Codex CLI/SDK 仍是另一种适用范围。官方 `codex exec` 可以复用本机已保存登录，也有可信私有自动化的认证维护方案；该机制不能被用作本项目远程多用户服务的接入依据。[非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)、[私有自动化](https://learn.chatgpt.com/docs/auth/ci-cd-auth)

## 对 Central.ai 生成能力的影响

SIWC plan usage 的 preview 文档支持适合剧本、人物设定、资产提示词和分镜的文本生成，以及模型接受的图像/文件输入；它目前不支持该路线的原生图像生成、音视频输入、转录、Files 上传 API 或 hosted MCP。人物成图和 Seedance 等视频仍需独立生成服务，不能承诺由 ChatGPT 计划一并覆盖。[Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

模型目录应跟随选定账户实际返回值，不能硬编码“所有订阅都支持某模型”。按官方 plan-usage 请求契约使用公共 Responses API，等到 `response.completed` 才能显示成功。[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)

## 两个技能的实际接法

`realistic-character-sheet` 和 `short-drama-prompts` 是工作流，不是模型服务或账户凭证。当前网页把其规则整合成结构编译器。SIWC 获批后，可在服务端把经过审阅的技能说明、输入与结构约束作为创作上下文，并通过现有校验器验证输出；有脚本、搜索或图像工具的步骤需另外提供真实能力。

若以后采用 Agents API，官方托管 Codex harness 可以从 sandbox 的 `environment.capability_directories` 发现技能，但该 API 的 Platform 凭证和计费不是 SIWC 计划额度路径，不能默认替代用户已选择的订阅方案。[Skills](https://developers.openai.com/api/docs/guides/tools-skills)、[Agents API](https://developers.openai.com/api/docs/guides/agents-api/overview)

详细服务端 OAuth 契约、待批准配置与验收条件见 [CHATGPT-SIGNIN.md](CHATGPT-SIGNIN.md)。
