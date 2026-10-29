# Central.ai Google 登录配置

更新时间：2026-10-30（Asia/Shanghai）。

## 当前状态

代码已经支持 Google Identity Services 的真实登录链路：Google 按钮 → 一次性 nonce → 官方 Google SDK 验签 → Central.ai 登录状态。**现在没有 Google Web OAuth 客户端 ID，也没有已部署的登录后端，因此现有 GitHub Pages 站点仍显示「待配置」，不能声称已经能够登录。**

Google 登录只负责身份，不会开启任何 OpenAI、Codex、图片或视频付费 API。Google 用户 ID、API Key 与 Codex 订阅是不同的凭证。

## 一、在 Google Cloud 创建 Web OAuth 客户端

这一部分由项目所有者在自己的 Google Cloud 账号中完成；无需把密码、Client Secret 或 API Key 发到聊天里。

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)，选择已有项目或为 Central.ai 新建项目。
2. 打开 Google Auth Platform（或「API 和服务 → OAuth 同意屏幕」）。填写应用品牌名 **Central.ai**、支持邮箱与开发者联系邮箱。
3. 根据使用范围选择 Audience。先测试时保持 Testing，并把自己的 Google 账号加入 Test users；公开使用前按 Google 控制台要求完成发布与所需验证。
4. 只使用登录所需的 `openid`、`email`、`profile`。此实现不申请 Drive、Gmail、通讯录等额外权限。
5. 在 Clients（或「凭据」）中创建 **OAuth client ID → Web application**。
6. 在 **Authorized JavaScript origins** 添加实际显示 Google 登录按钮的网页来源：

   ```text
   https://fenglingai-max.github.io
   http://localhost:4173
   http://localhost:3000
   ```

   这些是 Origin，**不能加 `/central-ai/` 或其他路径**。`localhost` 与 `127.0.0.1` 也是不同来源；若使用后者，单独添加对应端口。生产后端如果也同源提供网页，还需加入它的 HTTPS Origin。

7. 本实现采用 GIS 弹窗 JavaScript callback，不使用 authorization-code redirect，因此不需要为本代码添加 OAuth 回调路径。若以后改用重定向流，再按真实回调地址配置，不能猜一个 URL。
8. 保存后取得以 `.apps.googleusercontent.com` 结尾的 **Client ID**。它是公开的应用标识，可以填入配置或提供给协作者。此 GIS 登录流程**不需要 Client Secret**。

Google 的品牌、域名、主页或隐私页面要求以控制台当前提示为准；正式公开发布前，填写属于 Central.ai 的真实页面，不能使用虚构的政策地址。

官方配置说明：[Setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)。

## 二、启动登录后端

当前选择的是「每位用户在自己电脑运行 Central.ai，使用自己的 ChatGPT 计划」。本机模式默认启用，只监听 loopback；公开 GitHub Pages 不会连接或使用你的本机凭证。若未来单独部署公网 Google 登录 API，必须设置 `CENTRAL_LOCAL_CHATGPT_ENABLED=false`，该服务不能提供本机 ChatGPT 计划接口。

GitHub Pages 只能托管静态网页，不能运行 `server/`。需要一个能运行 Node.js 22+、提供公网 HTTPS 的服务；可以与网页同源部署，也可以只提供 API 给 GitHub Pages。当前仓库未替你创建外部托管账号、生产环境或凭证。

本地准备：

```sh
npm install
npm run build
cp server/.env.example server/.env
# 编辑 server/.env，填入自己的 GOOGLE_CLIENT_ID。
node --env-file=server/.env server/index.js
```

同源开发页面：`http://localhost:3000`。`npm run dev` 的静态预览位于 `http://localhost:4173`；本机 ChatGPT 登录必须使用 Node 提供的 `http://localhost:3000` 或 `http://127.0.0.1:3000` 同源网页，静态预览页不能跨端口调用它。

主要配置：

| 配置 | 内容 |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google Web OAuth Client ID；不得用 Client Secret 代替 |
| `CENTRAL_PUBLIC_ORIGIN` | 当前 Node 服务的真实 Origin，如 `https://api.your-domain.example`；不得加路径 |
| `CENTRAL_ALLOWED_ORIGINS` | 可调用此 API 的精确前端 Origin，以逗号分隔；GitHub Pages 为 `https://fenglingai-max.github.io` |
| `PORT` | Node 监听端口，默认 `3000` |
| `HOST` | 默认 `127.0.0.1`；本机 ChatGPT 模式禁止 `0.0.0.0` 和公网监听。仅关闭本机 ChatGPT 的 Google-only 托管服务可按部署平台设置 |
| `CENTRAL_LOCAL_CHATGPT_ENABLED` | 默认 `true`，本人本机模式；公网 Google-only 服务须明确设为 `false`，本机 ChatGPT 路由会禁用 |
| `CENTRAL_DEV_INSECURE_COOKIES` | 仅本地 HTTP 回环开发可为 `true`；生产必须为 `false` 或不设置 |
| `NODE_ENV` | 生产设置 `production` |

生产必须有 HTTPS，前置代理按真实部署终止 TLS。不要把 `.env` 放进 Git、`public/`、`dist/` 或公开下载目录；服务仅从 `dist/` 提供静态文件。

## 三、连接已发布的 GitHub Pages 前端

`public/runtime-config.json` 是公开配置，不放密钥。默认未启用。拥有实际后端后，改为：

```json
{
  "authEnabled": true,
  "apiBaseUrl": "https://api.your-domain.example",
  "googleClientId": "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com"
}
```

上面域名与 ID 都是占位，必须替换为真实值。后端 `GOOGLE_CLIENT_ID` 与前端 Client ID 要一致；后端配置是验签的权威。更新后重新构建并发布 GitHub Pages。生产前端需要同时满足：

- Google OAuth 客户端允许 `https://fenglingai-max.github.io`。
- 后端 CORS 允许 `https://fenglingai-max.github.io`。
- `apiBaseUrl` 指向真实可访问的 HTTPS 服务。
- `/api/config` 返回 `google.configured: true` 与正确的公开 Client ID。

**同源 Node 部署不需要手写前端 runtime config。** Node 的 `GET /runtime-config.json` 动态返回 `authEnabled: true`、同源 API 地址与真实 Client ID；`GET /api/config` 会准确说明是否已配置。未填 Client ID 时，不会创建假的登录用户。

## 四、登录时实际发生什么

1. 浏览器读取公开运行配置和 `/api/config`。
2. 用户发起登录，浏览器 `POST /api/auth/challenge`，服务器生成绑定 Origin、5 分钟有效的一次性 `challengeId` 和 `nonce`。
3. 浏览器将 nonce 放进 `google.accounts.id.initialize()` 并显示 Google 官方按钮。用户在 Google 界面选择账号。
4. GIS callback 返回 `credential`。浏览器通过 HTTPS `POST /api/auth/google` 提交 `{credential, challengeId}`。
5. 后端先原子消耗 challenge，再使用官方 `google-auth-library` 的 `verifyIdToken()` 验证签名。随后检查 `aud`、`iss`、`exp`、`iat`、`sub` 和 nonce。不使用开发调试用途的 `tokeninfo` 充当生产验签。
6. 只有验证通过后，返回公开用户信息并建立真实 Central.ai 登录状态。用户唯一标识是 Google `sub`，不是可变邮箱；不通过邮箱自动关联其他账号。

本代码使用 JSON callback + 精确 Origin 限制 + 一次性 nonce。若改用 Google GIS 自动 POST 重定向流，还须实现其 `g_csrf_token` 双重提交 Cookie 检查，不能直接把重定向请求塞进本接口。

官方依据：[Verify the Google ID token on your server side](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)、[GIS JavaScript API](https://developers.google.com/identity/gsi/web/reference/js-reference)。

## 五、会话与跨源策略

| 部署 | 会话方式 | 刷新页面 |
| --- | --- | --- |
| 网页与 Node API 同源 | 随机 opaque 会话 Cookie；`HttpOnly; Secure; SameSite=Lax; Path=/`，生产名 `__Host-central_session` | 在有效期内可恢复会话 |
| GitHub Pages → 独立 HTTPS API | 成功 nonce exchange 后，浏览器仅在内存保留 Google ID token，后续用 `Authorization: Bearer`；后端只保存 token 的 SHA-256 grant | 内存凭证丢失，需要再次登录 |

同源会话最长 1 小时且不超过 Google ID token 原始有效期。跨源 grant 最长 15 分钟且不超过 Google token 原始有效期；每次 bearer 验证仍通过 Google 官方 SDK，并检查 grant 的 Origin 与 nonce。未先完成 challenge exchange 的裸 ID token 不被接受。Cookie 不跨源接受，CORS 不开启第三方 Cookie 权限。原始 token 不存入 localStorage、IndexedDB、日志或草稿 JSON。

退出会撤销 Central.ai 的相关会话和 bearer grant；它不会退出用户的整个 Google 账号，也不会撤销 Google 账号本身。

**当前后端是单进程内存会话实现。** 服务重启会清空会话与 nonce。多实例或自动横向扩展前，必须改为共享 TTL 存储、共享原子 nonce 消耗与会话撤销；本版本不能直接声称已经支持多实例生产会话。还需在真实代理环境配置请求限流；代码不盲信客户端 `X-Forwarded-For`。

## 六、API 契约与验证

| 接口 | 方法 | 内容 |
| --- | --- | --- |
| `/runtime-config.json` | GET | Node 同源动态公开配置 |
| `/api/health` | GET | 服务存活与 `googleConfigured`；不代表登录成功 |
| `/api/config` | GET | `{google:{configured,clientId}, authentication:{...}, services:{creative:false,image:false,video:false}}` |
| `/api/auth/challenge` | POST JSON `{}` | `{challengeId,nonce,expiresAt}` |
| `/api/auth/google` | POST JSON `{credential,challengeId}` | `{user,expiresAt,bearerExpiresAt,authentication:'google'}`；同源另设置 Cookie |
| `/api/auth/session` | GET | `{authenticated:true,user,expiresAt}`；未登录返回 `401 / unauthenticated` |
| `/api/auth/logout` | POST JSON `{}` | 撤销并返回 204 |

所有 POST 要求精确允许的浏览器 `Origin` 与 `application/json`，请求体有 20 KB 上限。未配置客户端 ID 的登录接口返回 `503 / not_configured`。错误统一为 `{error:{code,message}}`，不返回凭证、provider 原始错误或堆栈。

运行：

```sh
npm test
```

身份验证测试覆盖 nonce 并发/重放、Origin、签发方与受众、时间、会话过期、注销、裸 bearer 拒绝、错误隔离、请求大小和限流。测试使用注入的验证器；它们证明本地控制流，**不代表已经完成真实 Google 账号登录验收**。取得真实 Client ID 与部署后，还需在真实域名手动验证成功登录、拒绝无效账号/来源、退出与重新登录。
