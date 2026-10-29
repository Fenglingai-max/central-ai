# Central.ai 本机 Codex 连接

当前选择：每位用户在自己的电脑运行 Central.ai，用本人官方 Codex 客户端已登录的 ChatGPT 账号和可用套餐。公网 GitHub Pages 只作介绍/演示，不代理开发者账号。

## 实际实现

`server/chatgpt-local.js` 是独立编写的本机桥接模块，不分发 SIWC DevKit，也不需要 SIWC 客户端 ID、API Key 或额外 SDK 依赖。

- 启动时寻找 PATH 中的 `codex`，也识别当前 macOS ChatGPT 应用内的官方 CLI。可用 `CENTRAL_CODEX_PATH` 指定官方可执行文件。
- 只读状态通过 `codex login status` 和官方 app-server `account/read` 核验。仅 `chatgpt` 登录模式通过个人套餐 gate；API Key 登录不作为套餐授权。
- 登录按钮启动官方 `codex login`，由用户在系统浏览器完成正常流程；应用不读取、导出或自己刷新认证缓存。
- 本机桥接只使用当前 Codex 账号；切换账号在 Codex 中完成。退出调用 `codex logout`，会退出当前本机共享的 Codex 登录，并非只删除本站 Cookie。
- 模型来自官方 app-server `model/list`。不硬编码用户能用的模型或保证额度。
- 文本通过 `codex exec --ephemeral --json`，stdin 传入创作输入，保持只读沙箱，只有退出成功、收到 `turn.completed` 和非空 agent final message 才返回成功。
- 图片通过 app-server 原生 `image_generation`，只接受真实 `item/completed` 中 `type: imageGeneration`、`status: completed`、无 failure 的工具记录；普通“生成完成”文字或单独存在的 PNG 均不算成功。检查工具返回 `savedPath` 是 regular PNG、大小上限和目标路径，再由 Node 复制到独立图片任务目录。

文本与图片都禁用 shell、apps、plugins、browser_use、computer_use；图片只开启原生生成能力。保留沙箱和 `approvalPolicy: never`，遇到需要审批的请求拒绝，不绕过沙箱。子进程只继承必要 OS、本机 Codex 位置、网络代理和 CA 环境，不继承 API Key、外部令牌或未知服务密钥。

本机 HTTP 层必须绑定 `127.0.0.1`，限制 Host/Origin 和请求来源；它不能部署成公开多人服务。该边界由 `server/app.js` 实施。

## 状态与能力

状态仍是 `disconnected` / `connecting` / `connected` / `reauth_required`，`sharing: true` 在此本机适配器中表示已核验本人 Codex 的 ChatGPT 登录，不是 SIWC `chatgpt.tokens.use.direct` scope。`provider` 为 `codex`。

`capabilities.images` 来自当前 CLI `features list` 对 `image_generation` 的实际检测，不保证每个账户或运行环境均可出图。图片生成失败、网络/额度错误、丢失真实工具记录或仅返回 fileId 时会明确失败。视频仍需另外接入对应模型。

## 官方依据与限制

官方支持 Codex SDK / CLI 的本机和可信自动化，并明确 app-server 认证不能用于商业或托管服务。本项目采用用户选择的个人本机模式；并未把私有认证搬到远程服务器。[Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)、[非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)、[App-server](https://learn.chatgpt.com/docs/app-server#auth-endpoints)

当前机器的 Codex 0.165.0 系列本机 CLI（实际安装版本以运行检测为准）schema 中有原生 `imageGeneration` 项目；它与 SIWC direct-plan preview 的能力不是同一接口。因此不能用 SIWC direct 不支持图片的说明去否认当前本机 Codex 的实际工具能力。

## 验证记录

2026-10-30 已完成：8 项 mock 回归测试、只读本机状态检查，实际检测结果为 Codex 已连接 ChatGPT 且 `image_generation` 已启用。没有启动真实授权或文本/图片生成任务。真实生成由用户在本机页面点击后执行，成功与否以工具完成记录和产物校验为准。

## 下载和启动

安装 Node.js 22+ 和官方 Codex CLI，解压本项目后，macOS 可以双击 `start.command`，Windows 可运行 `start.bat`。也可在项目目录执行：

```sh
node scripts/run-local.mjs
```

脚本会构建界面、启动服务并打开 `http://localhost:3000`。本机 Codex 功能不需要 API Key，也不要求配置 Google Client ID。可选 Google 网站登录才需要 `pnpm install` 安装其验证依赖和单独配置客户端 ID。

页面里选择“角色资产 / 道具资产 / 完整创作包”时，文字完成后会逐张生成对应图片；“AI 提示词”模式只生成文字。也可以打开单张资产提示词后点击“用本机 Codex 生成图片”。当前项目保存在本机浏览器，图片保存在 `server/local-data/images/`，没有云端同步。

若没有检测到 CLI，可复制 `server/.env.example` 为 `server/.env`，填写 `CENTRAL_CODEX_PATH` 的绝对路径。Windows 需要官方原生 `codex.exe`；仅有 npm 命令包装器而找不到原生可执行文件时，请按官方安装指南安装或指定实际可执行文件。

图片生成结果依旧标为“待人工审核”；需要检查人物身份、服装结构、方向、道具形状与质感。当前部署不会自动生成视频。切换 localhost 与 127.0.0.1 会切换浏览器数据来源，建议固定使用 localhost。
