# Central.ai 视频模型官方资料核验

checkedAt: **2026-10-29**（Asia/Shanghai）。所有条目仅来自厂商文档；Central.ai 本阶段的实际接入状态均为「API 待接入」。官方提供 API 不代表本网站已经可以调用。时长选项应由模型和任务类型共同约束。

| 选择器条目 | 官方入口与能力 | 已核验限制 | 建议 UI 状态 |
| --- | --- | --- | --- |
| Seedance 2.5 | 火山方舟；文生、首帧、首尾帧、全模态参考、编辑和延长；有声/无声 | 生成 4–30 秒（或智能时长 -1）；480p/720p/1080p；参考最多 30 图、10 视频、10 音频。视频编辑只能 duration=-1，输入编辑视频 4–30 秒 | 推荐 / API 待接入 |
| Seedance 2.0 | 火山方舟；文生、首帧、首尾帧、多模态参考 | 生成 4–15 秒；标准版 480p/720p/1080p/4K，fast/mini 仅 480p/720p；最多 9 图、3 视频、3 音频，不可只传音频 | API 待接入 / 30 秒主段需拆分 |
| Kling 4.0 | 可灵开放平台 2026-10-28 更新；文生、图生、Omni 参考；关键帧、原生音画 | 3–30 秒；720p/1080p，4K 官方标为即将推出；最多 10 关键帧，参考上限 10 图/5 视频，混合任务最多 15 输入 | 新模型 / API 待接入 |
| Veo 3.1 GA | Google Cloud Gemini Enterprise Agent Platform（Vertex 系列 API）；text/image、首尾帧、资产参考、延长、声音 | modelId `veo-3.1-generate-001`；4/6/8 秒，参考图仅 8 秒；16:9/9:16，24fps；模型卡列 720p/1080p/4K。不同入口文档对 4K 条件有差异，接入前按目标地区/协议复核 | Cloud API 待接入；默认暴露 720p/1080p |
| Runway Gen-4.5 | Runway Dev API model `gen4.5`；文生/图生；API 模型目录确认存在 | 官方产品规格 2–10 秒、720p；图生支持多种画幅，文生规格表仅 16:9；不要把其他供应商由 Runway 代理的功能当作 Gen-4.5 自身能力 | API 待接入；参数按任务类型 |
| Wan 2.7 | 阿里云百炼 Model Studio；`wan2.7-t2v` / `wan2.7-t2v-2026-06-12`，异步创建和轮询；文生，多镜头自然语言，音频输入/自动音效 | 2–15 秒整数；720P/1080P；16:9、9:16、1:1、4:3、3:4；提示最多 5000 字符。此条仅确认 t2v，不把其他 Wan 版本参考视频能力移植过来 | API 待接入 / 30 秒主段需拆分 |
| Sora 2 | OpenAI 历史模型 | **Sora API 与 Videos API 已于 2026-09-24 关闭**，无一对一替代 API | 已停服，禁用选择；只留历史说明 |

## 官方来源

- Seedance 当前创建任务 API（能力、时长、分辨率、参考上限）：[火山方舟 API](https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh)
- Seedance 2.0 模型页：[Seedance 2.0](https://docs.volcengine.com/docs/ark/seedance-2-0?lang=en)
- Kling 4.0 官方更新（2026-10-28）：[Kling API Updates](https://kling.ai/document-api/updates/api?date=2026-02-11)
- Kling 官方创作入口（显示 3/5/10/15/20/25/30 秒和 4K Coming Soon）：[Kling 官方页面](https://kling.ai/app/API%20Documentation)
- Veo Cloud GA 模型卡：[Veo 3.1](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate?hl=en)
- Veo Cloud 文生 API：[Generate videos from text](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/generate-videos-from-text?hl=en)
- Veo Cloud 参考资产 API：[Generate from references](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/generate-videos-from-references?hl=en)
- 注意：Gemini Developer API 的 Veo 3.1 Preview 已于 2026-10-22 关闭；不能继续用旧 Preview modelId：[Google 官方弃用提示](https://ai.google.dev/gemini-api/docs/veo?hl=en)
- Runway 开发者模型目录：[Available AI Models](https://docs.dev.runwayml.com/guides/models/)
- Runway 自家产品规格：[Creating with Gen-4.5](https://help.runwayml.com/hc/en-us/articles/46974685288467-Creating-with-Gen-4-5)
- Runway API：[API Reference](https://docs.dev.runwayml.com/api/)
- Wan 当前文生 API（文档更新 2026-10-27）：[Wan2.7 API Reference](https://www.alibabacloud.com/help/en/model-studio/text-to-video-api-reference)
- Sora 官方停服说明：[What to know about Sora discontinuation](https://help.openai.com/en/articles/20001152-what-to-know-about-the-sora-discontinuation)
- Sora 历史指南顶部也明确已关闭：[Video generation with Sora](https://developers.openai.com/api/docs/guides/video-generation)

## 实现建议

1. 默认选 Seedance 2.5，允许切换 Seedance 2.0 / Kling 4.0 / Veo 3.1 / Runway Gen-4.5 / Wan 2.7。Sora 2 在历史区禁用。
2. 参数建议记录 `provider`, `model`, `integrationStatus: "not_connected"`, `availability`, `durationOptions`, `resolutions`, `supportedInputs`, `sourceUrl`, `checkedAt`；用独立数据文件，不把限制写死在多个组件内。
3. 30 秒是导演交付单元，仍保留完整主段；模型上限不足 30 秒时生成按镜头边界拆开的提交子段，绝不静默裁掉后半段或改变原剧本。
4. 图生/参考模式要检查实际引用文件；角色四视图不是模型必然支持的人脸参考格式。上传并选择参考后才放入请求，模型不支持的类型应说明并禁用。
5. 「生成视频」在待接入阶段保存请求草稿/导出 JSON，并提示未发送，不制造进度条或完成视频。服务端适配器未来负责创建任务、轮询、错误转换和视频下载。
6. API Key 仅留服务端环境变量；GitHub Pages 的静态前端不接收或持久化密钥。实时定价、地区可用性、账户开通条件交给接入时复核，不显示未经核验的成本估算。

## 尚未验证

未开通任何供应商账号、未发送付费请求、未验证地区账户实际配额。Kling 页面为动态内容，更新正文由搜索索引可读取，但浏览 open 仅返回壳；发布前端可链接原文，真正接入时再次读取目标接口 schema。Runway Gen-4.5 精确 API ratio 枚举应在接入时核对，当前产品规格不等同于所有 API 字段值。
