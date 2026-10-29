# Central.ai

**Good stories start with you.**

主题、人像与风格参考 → 角色 / 场景 / 道具 / 分镜 → 视频模型。简约白色编辑台、Inter 可变字体与原创 SVG 标识。

- [在线演示](https://fenglingai-max.github.io/central-ai/)
- **[下载本机版](https://github.com/Fenglingai-max/central-ai/archive/refs/heads/main.zip)**
- **[本机安装与 Codex 使用指南](docs/LOCAL-CODEX.md)**

## 本机个人模式

每位用户在自己电脑运行，使用本人官方 Codex CLI 中的 ChatGPT 登录。文字与原生图片生成都走本机 Codex，不使用站长 Key，不复制或公开用户凭证。

需要 Node.js 22+ 及官方 Codex CLI。macOS 可双击 `start.command`，Windows 可运行 `start.bat`；也可以：

```sh
node scripts/run-local.mjs
```

打开 `http://localhost:3000`，点击“连接 Codex”。模型列表来自该账号的 Codex；图片工具在本机检测，真实可用性以实际调用为准。程序不保证每个免费账号或每个 CLI 版本都有图像能力。

- 角色、道具、完整包：先真实文字创作，再逐张原生图片任务；提示词模式不出图。
- 人物默认横向 16:9 四视角；对白锁定，每场 30 秒、镜头 2–5 秒。
- 图像成功需原生工具完成记录和实际 PNG；生成后仍待人工审核。
- 视频 API 待接入，未伪装成已生成视频。
- 项目与参考保存在当前浏览器，图片文件保存在本机 `server/local-data/`，没有云同步。
- “退出本机 Codex”会退出这台电脑共用的 CLI 登录。

在线 GitHub Pages 仅提供结构演示、下载和说明，不调用用户的 localhost，不共享任何订阅。公网用户直接使用各自 ChatGPT 计划的服务需取得官方 SIWC 接入资格；当前选择的是个人本机模式。

## 开发和静态发布

可选 Google 网站登录采用独立服务端验证，需要先配置 OAuth Web Client ID；它不是本机 Codex 的前置条件，也不会授予 AI 额度。

```sh
pnpm install
pnpm test
pnpm run build
pnpm start
```

Google 认证依赖已锁定，Node >=22。静态构建产物为 `dist/`，GitHub Actions 测试后发布 Pages。默认 `runtime-config.json` 关闭公网 Google 登录，未配置时明确说明。

## 文档

- [本机 Codex](docs/LOCAL-CODEX.md)
- [Google 登录配置](docs/GOOGLE-LOGIN.md)
- [ChatGPT / Codex 接入范围](docs/OPENAI-INTEGRATION.md)
- [SIWC 公网方案](docs/CHATGPT-SIGNIN.md)
- [模型官方资料](docs/MODELS.md)
- [两技能整合](docs/SKILL-INTEGRATION.md)
- [品牌规范](docs/BRAND.md)

摄影示例来自 [Pexels](public/assets/SOURCES.md)，不是生成成品。Inter 许可随项目附带。未把官方 DevKit 的非商用代码作为本机运行依赖；本版调用用户另行安装的官方 Codex CLI。
