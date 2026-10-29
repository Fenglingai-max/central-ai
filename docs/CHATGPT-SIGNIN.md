# Central.ai：Sign in with ChatGPT 备选方案记录

> 用户最终选择了个人本机 Codex 版本，当前实现见 [LOCAL-CODEX.md](LOCAL-CODEX.md)。本文件的托管 SIWC 接入准备暂不启用；没有提交申请。

核验日期：2026-10-30（Asia/Shanghai）。此文是待获批的实现契约，不是已接通声明。目标是每个用户授权自己的 ChatGPT 计划；不共享开发者个人 Codex 账号，不默认回退到网站付费 API Key。

## 1. 先确认远程托管资格

Central.ai 的 GitHub Pages 地址是 `https://fenglingai-max.github.io/central-ai/`，属于远程托管应用。官方要求此类应用先申请 SIWC 接入，且需明确申请 **ChatGPT plan usage**，不能只申请身份登录。当前商业接入是选定伙伴 limited trial；没有依据承诺审批时间或必然通过。[Quickstart](https://developers.openai.com/siwc/quickstart)、[使用范围](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt#usage-policy-and-terms)

[Request a client ID](https://developers.openai.com/siwc/request-client-id) 链接到官方接入意向表。本文没有代用户提交该表，也没有接受任何条款。

申请前准备以下资料，具体必填项以官方表单和后续对接为准：

- 产品：Central.ai；公开代码、现有网页和用途：短剧故事、人物设定、分镜及生成提示词。
- 场景：远程托管网站、多用户、每人使用自己的 ChatGPT 计划；需同时确认网站身份登录与 hosted plan usage 资格。
- 前端公开地址，以及将实际承载认证的服务端 HTTPS 域名。
- 每个环境的**精确** OAuth callback URL、应用退出和隐私说明；最终域名确定后注册，不能使用随意通配符。
- 希望采用 public 或 confidential client 的原因；由 OpenAI 实际注册方式决定是否有 Client Secret。
- 数据用途、会话/令牌保管、用户断开连接和用量管理的设计。

注意：官方本地开源 direct flow 的 `dynamic_agent_client`、安装级 host ID 和 `127.0.0.1` callback 不是公网网站的免审批捷径。网站必须使用被 provision 的 OAuth 客户端与注册回调。[网站指南](https://developers.openai.com/siwc/website)、[本地注册流程](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)

## 2. 部署形态

建议把静态工作台和后端 BFF 放到同一个 HTTPS origin：

```text
浏览器
  → Central.ai HTTPS 页面 / 第一方会话
  → Central.ai 后端 OAuth 与逐用户凭证库
  → OpenAI 正式授权端 / 该用户获授权的推理端点
```

GitHub Pages 只提供静态文件，不能运行 OAuth code exchange、会话存储或推理代理。可继续保留为演示入口；真正登录和生成版需要可部署的服务端。不要为绕过跨站 Cookie 限制把 OpenAI access/refresh token 返回网页、写 localStorage 或放进 URL。

## 3. 服务端配置契约

以下为 Central.ai 建议名称，不是已经取得的凭证或官方强制变量名：

| 配置 | 当前默认 / 要求 |
| --- | --- |
| `CENTRAL_PUBLIC_ORIGIN` | 实际生产 HTTPS origin；与认证回调和会话策略一致 |
| `CHATGPT_SIWC_ENABLED` | 默认 `false`；未配置时显示待接入 |
| `CHATGPT_SIWC_CLIENT_ID` | OpenAI 实际 provision 的网站客户端 ID，通常以 `oaiapp_` 开头 |
| `CHATGPT_SIWC_REDIRECT_URI` | 实际注册的 `https://YOUR_BACKEND/api/auth/chatgpt/callback`；示例占位符不能发布为真实地址 |
| `CHATGPT_SIWC_TOKEN_AUTH_METHOD` | 只能与注册值一致：`none` 或 `client_secret_basic` |
| `CHATGPT_SIWC_CLIENT_SECRET` | 仅 confidential client 需要；只存服务端 Secret Manager |
| `CHATGPT_SIWC_IDENTITY_SCOPES` | `openid profile email` |
| `CHATGPT_SIWC_PLAN_USAGE_APPROVED` | 默认 `false`；本地配置不是 OpenAI 批准的替代证据 |
| `CHATGPT_SIWC_PLAN_SCOPES` | 仅使用伙伴批准并实际返回的 scopes；identity-only 配置不得凭空启用推理 |
| `CENTRAL_SESSION_SECRET` / 会话库 | 受保护的会话服务与有期限存储；多实例支持原子一次性消费 |
| `CENTRAL_TOKEN_ENCRYPTION_KEY` / 凭证库 | 对不同应用用户分别存储加密凭证，密钥与库分离 |

官方 production OIDC discovery：`https://auth.openai.com/.well-known/openid-configuration`。从 discovery 读取并核对 `issuer`、`authorization_endpoint`、`token_endpoint` 和 `jwks_uri`，不使用 ChatGPT 内部 backend-api。[网站 OAuth 前置配置](https://developers.openai.com/siwc/website#before-you-begin)

现有本地 open-source plan 文档的 scopes 是 `offline_access resource.invoke chatgpt.tokens.use.direct`，resource 为 `https://api.openai.com/v1`；它们只可作为沟通计划使用权限的参考，不证明当前 Central.ai 远程客户端已被授予同样权限。正式托管 plan contract 需由 OpenAI 对接确认。[注册与授权](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)

## 4. 后端路由与状态

建议路由如下，可与现有 Google 登录共存：

| 路由 | 作用 |
| --- | --- |
| `GET /api/auth/chatgpt/status` | 返回已配置/待审批/已连接/需重连；只返回公开能力与账号显示信息 |
| `GET /api/auth/chatgpt/start` | 创建 OAuth 事务并重定向到 OpenAI；未 provision 时返回明确不可用状态 |
| `GET /api/auth/chatgpt/callback` | 验证一次性事务、换码、验 ID token、确认实际授权，再创建 Central.ai 会话 |
| `POST /api/auth/chatgpt/disconnect` | CSRF 验证后断开该用户连接、清除其凭证；不登出其他账号 |
| `GET /api/chatgpt/models` | 仅从当前应用用户的获授权连接发现可用模型 |
| `POST /api/creative-jobs` | 验会话、逐用户额度状态、实际权限和请求体后才发起生成 |

`status` 响应示意，不含 token：

```json
{
  "provider": "chatgpt",
  "configured": false,
  "identity": { "connected": false, "account": null },
  "planUsage": {
    "available": false,
    "enabled": false,
    "status": "partner_access_required"
  }
}
```

Google 与 OpenAI 外部身份分别以 provider、issuer、client ID 和验证过的 `sub` 绑定应用用户。不能仅凭 email 相同自动合并账号；已登录用户必须确认关联。[账号关联](https://developers.openai.com/siwc/website#7-find-create-or-link-the-local-account)

## 5. OAuth 事务

实现 website 指南的 Authorization Code + PKCE + OIDC 流程：

1. 服务端产生随机 `state`、PKCE verifier / S256 challenge、`nonce`；和短期浏览器会话关联，约 10 分钟后失效。
2. 使用 `HttpOnly; Secure; SameSite=Lax` 第一方事务 Cookie，只在服务端保存 verifier、原 callback 和事务内容。
3. 授权请求带注册 client ID、精确 callback、身份 scopes、state、nonce 与 challenge；获批额度权限需另按该客户端的正式契约请求。
4. callback 原子消费事务，校验 state、期限和错误；拒绝重复、缺失或不匹配回调，未经验证不换码。
5. 服务端用原 verifier、callback 和注册的 token auth method 换码。`client_secret_basic` 密钥只放 HTTP Basic 头；public client 不发送 Secret。
6. 使用维护中的 JWT/OIDC 库，按 discovery JWKS 验 signature、issuer、audience、exp 与原 nonce。
7. 身份登录不要求推理 access token。只有额度授权实际存在、客户端获批且令牌契约满足时，才将计划使用标为 enabled；失败不伪造连接状态。
8. 创建独立 Central.ai 第一方会话。清理临时事务和 Cookie，不把 raw code、verifier、ID token 或 Secret 返回前端。

这是服务端契约摘要，生产实现需按正式 provision 的客户端验证，不能把示例内存 Map 当多实例持久存储。[网站 OAuth 指南](https://developers.openai.com/siwc/website)

## 6. 额度推理契约与前端

在 hosted plan usage 获批、合同确认之后，复用正式逐用户连接。当前官方 open-source plan preview 文档给出的调用方式是：从相同用户的 `GET https://api.openai.com/v1/models` 获取 `visibility=list` 的显示名与 `slug`，再用其 OAuth access token 调用公共 `POST /v1/responses`，不访问内部 ChatGPT endpoints。[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)

当前 preview 对 HTTP 要求 `store:false`、`stream:true` 和 `input` 数组；应用只在收到 `response.completed` 后接受结果。中途失败、incomplete 或流中额度错误都不能当成功。服务端将失败转换成可操作的前端状态，不能悄悄改用开发者 API Key 收费。

界面应包含：

- 使用官方认可标识、明确标注 **Continue with ChatGPT**；相近视觉权重，不伪装成 Google 登录。
- 身份已连接与计划使用已启用分别显示；额度未授权时给重新授权入口。
- 模型区显示“使用你的 ChatGPT 计划”，并提供 [Manage usage](https://chatgpt.com/settings/usage)。
- 额度不足、不可用、需重连与生成失败独立显示；不承诺无限用量。

目前此路线不支持原生图像生成或视频 API。Central.ai 的角色图片、道具图片和 Seedance 等视频仍要另外接入生成供应商。[Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

## 7. 验收与当前待办

- 资格：确认 Central.ai **远程托管** 客户端和计划使用权限获批，保存实际 provision 配置。
- 授权：state / nonce / PKCE、回调重放、验签失败、错误 audience、过期和撤销都有失败分支。
- 隔离：用户 A 不可读取或使用用户 B 的连接；登录 Google 不应获得 ChatGPT 额度调用权。
- 推理：identity-only 无法调用；实际模型列表和流式完成事件通过后再展示可用。
- 运维：安全会话、加密凭证库、刷新并发、断开连接和额度管理入口可用。

当前仅准备上述设计与配置说明；尚未提交官方申请、拿到 SIWC client ID、部署真实后端或完成一次用户计划推理。所有相关按钮须真实显示“待官方接入资格 / 待配置”，不能声称已连通。
