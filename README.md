# Central.ai

**让想象力，走到镜头前。**

从主题大纲、人像与风格参考，到角色资产、道具与短剧分镜，再衔接视频模型的双页创作工作台。采用简约白色的编辑台视觉，参考 Linear、Frame.io、Vercel 与 A24 的内容层级与留白；原创 Open Gate 标记与 Central.ai 字标。

- [在线体验](https://fenglingai-max.github.io/central-ai/)
- [模型调研与官方来源](docs/MODELS.md)
- [API 接入文档](docs/API.md)
- [技能整合说明](docs/SKILL-INTEGRATION.md)

## 当前能做什么

- 输入主题、风格、30/60/90/120 秒时长与视频画幅；补充角色、道具、场景和原始对白。
- 上传人像、风格、服装参考，预览、移除并用 IndexedDB 本地保存。示例摄影不会被自动用作人物身份。
- 选择角色资产、道具资产、AI 提示词或完整创作包；一键编译结构草案并跳转视频页。
- 角色按横向 16:9 单身份四视角准备；场景/道具保留无人、无手等约束。
- 每场 30 秒、单镜 2–5 秒；校验时长、对白原文与资产引用。
- 查看资产、故事、分镜、提示词和校验；编辑脚本/资产提示词/视频提示词；导出完整 Markdown 与 JSON。
- Seedance 2.5 / 2.0、Kling 4.0、Veo 3.1、Runway Gen-4.5、Wan 2.7 的参数选择与校验。Sora 2 历史项禁用。
- 按镜头边界拆分模型提交子段，保持完整 30 秒主段；保存、查看和下载视频请求草稿。
- 自动保存项目历史、输入、视频草稿；参考素材库与模型中心可用。

**所有 AI 服务均待接入。** 当前引擎只编译明确标记的本地结构草案，不进行主题语义创作、实款检索、图片生成、视觉审核或视频生成。未提交任何模型任务，不产生生成费用。结构校验通过不代表剧情或画面质量通过。不能把示例摄影、输入参考或空占位符当作 AI 生成结果。

## 本地运行

需要 Node.js 20+，没有第三方 npm 依赖。

```sh
npm run dev
# http://127.0.0.1:4173
npm test
npm run build
node scripts/server.mjs --dist
```

纯静态 HTML / CSS / ES Modules，支持 GitHub Pages 子路径。移动端会调整为单列。英文采用自托管 Inter 可变字体，中文采用系统无衬线字体回退；包含 Inter 开放许可。

## 发布

GitHub Actions 在 main 更新时先运行测试，再构建 dist 并部署 GitHub Pages。仓库 Settings → Pages → Source 需选择 GitHub Actions。无需 API Key、数据库或构建依赖。也可将 `dist/` 交给其他静态托管。

`.openai/hosting.json` 是 Sites 私有预览的部署标识，不包含密钥。公开 GitHub 源码不需要此文件；使用 Sites 创建自己的项目时必须取得自己的 project_id。

## 项目结构

```text
index.html
src/app.js          双页应用与本地保存
src/style.css       响应式界面
src/engine.js       两技能规则的结构编译器
src/models.js       官方模型能力与请求草稿校验
public/assets/     摄影示例与出处
scripts/           本地预览与静态构建
tests/             时长、对白、资产引用和模型约束测试
docs/              接入契约、技能映射与官方模型调研
```

## 数据与素材

主题、项目和草稿保存在当前浏览器 localStorage；参考图片保存在 IndexedDB。清理浏览器数据会删除它们，请用导出文件备份。没有登录、跨设备同步或云端存储。图像上传控件仅本地读取，草稿 JSON 仅包含文件元数据，尚无有效的供应商资产 ID。未来接入必须实现文件上传与服务端密钥管理。

摄影示例来自 Pexels，作者与图片来源见 [SOURCES](public/assets/SOURCES.md)。这些图片不是 Central.ai 生成资产，不代表真实用户，也不会自动参加生成。

本项目整合用户提供的 realistic-character-sheet 2.0.1 与 short-drama-prompts 1.0.1 的工作流规则；未复制其他插件的商标、账户能力或付费服务。
