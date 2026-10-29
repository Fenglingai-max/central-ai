# Central.ai API 接入方案

> 本文是后续实现契约，不是已部署服务说明。当前仓库为静态前端：没有生成服务、服务端鉴权、文件云上传、供应商调用或付费任务。页面产生的是本地结构草案。

## 1. 当前实现与接入边界

| 能力 | 当前已实现 | 后续服务端工作 |
| --- | --- | --- |
| 主题与参考输入 | 大纲、风格、角色/道具/地点与逐句对白输入；图片本地预览 | 结构化创作模型、输入校验、项目版本管理 |
| 创作包 | `src/engine.js` 的确定性结构编译与校验 | 根据主题真正创作剧本及设计资产，保留原台词 |
| 人物/道具/场景 | 完整提示词槽位，`image: null`，未出图 | 图片生成、身份参考绑定、实款记录、视觉审核 |
| 视频 | `src/models.js` 能力目录、草稿校验及镜头边界拆分 | 供应商请求转换、文件上传、异步任务、结果下载 |
| 数据保存 | 当前浏览器 localStorage / IndexedDB；Markdown / JSON 导出 | 用户项目数据库、对象存储、备份与权限 |
| 密钥 | 不收集、不保存、不提交供应商 API Key | 服务端环境变量或托管密钥服务 |

本地草稿的 `status: "demo"`、`generation.connected: false` 与视频草稿的 `status: "not_submitted"` 应保持真实。增加后端后也不能仅将它们改成成功来模拟实际调用。

## 2. 建议部署结构

```text
浏览器工作台
  ├─ /api/v1/capabilities           当前账户可用模型和模式
  ├─ /api/v1/references/*          临时上传凭证和素材元数据
  ├─ /api/v1/creative-jobs         文本创作任务
  ├─ /api/v1/image-jobs            资产图片任务
  ├─ /api/v1/video-jobs            视频任务
  ├─ /api/v1/jobs/:id              状态、错误和产物
  └─ /api/v1/projects/:id          项目及修订
                 │
         认证 / 校验 / 任务队列 / 数据库 / 对象存储
                 │
         TextAdapter / ImageAdapter / VideoAdapter
                 │
         各供应商官方 API（服务端请求）
```

前端可继续静态托管，API 使用同源反向代理或明确配置的服务端地址。跨域部署时配置受控来源和用户会话；浏览器只持有 Central.ai 会话，不持有供应商密钥。上传的本地 `dataUrl`、File 对象和文件名不能直接充当供应商素材 ID。

## 3. 服务端配置

下面是建议的环境变量名称，仅为约定，不表示当前实现会读取它们。未接入的供应商应保持禁用，不设置虚假可用状态。

| 环境变量 | 用途 |
| --- | --- |
| `CENTRAL_PUBLIC_ORIGIN` | 前端公开来源，用于会话与跨域配置 |
| `CENTRAL_DATABASE_URL` | 项目、修订、任务与审查记录数据库 |
| `CENTRAL_STORAGE_BUCKET` | 上传参考和生成产物的私有对象存储 |
| `CENTRAL_QUEUE_NAME` | 长任务队列 |
| `CENTRAL_TEXT_PROVIDER` / `CENTRAL_TEXT_MODEL` | 文本创作适配器与实际已开通模型 |
| `CENTRAL_IMAGE_PROVIDER` / `CENTRAL_IMAGE_MODEL` | 人物、场景与道具图像适配器 |
| `CENTRAL_TEXT_API_KEY` / `CENTRAL_IMAGE_API_KEY` | 相应服务密钥，按所选供应商调整 |
| `ARK_API_KEY` | 火山方舟视频适配器凭证，接入时核对官方鉴权 |
| `KLING_ACCESS_KEY` / `KLING_SECRET_KEY` | 可灵适配器凭证，接入时核对官方鉴权 |
| `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` | Google Cloud 视频服务项目和区域；凭证使用服务身份 |
| `RUNWAY_API_SECRET` | Runway 适配器密钥，名称为本项目建议约定 |
| `DASHSCOPE_API_KEY` | 通义万相适配器凭证，接入时核对区域和入口 |
| `CENTRAL_WEBHOOK_SECRET` | Central.ai 自身 webhook 或队列回调签名密钥 |

实际供应商要求、API 路径、模型 ID、鉴权方式与区域由适配器管理。密钥不写入 `src/`、`public/`、请求草稿、localStorage、错误日志或 Git 仓库。前端接入设置页只显示连接状态和能力；若以后提供密钥配置，提交到受认证的后端，不直接调用供应商。

## 4. 参考素材：先上传，再绑定用途

建议流程：

1. `POST /api/v1/references/init` 提交文件名、MIME、字节数与用途；服务端校验后返回临时上传 URL。
2. 浏览器将真实文件上传到对象存储。
3. `POST /api/v1/references/:id/complete`；后端验证对象存在、实际 MIME 和大小，生成稳定 `referenceId`。
4. 任务只引用状态为 `ready`、属于当前用户的素材。供应商专用上传由适配器执行，并保存上传映射。

```json
{
  "fileName": "linxia-portrait.png",
  "mimeType": "image/png",
  "size": 402118,
  "purpose": "identity",
  "binding": { "characterId": "C001" }
}
```

`purpose` 建议枚举：

| 用途 | 使用边界 |
| --- | --- |
| `identity` | 同一角色的脸部、发型与体态，不自动复制背景 |
| `wardrobe` | 领型、松量、肩线、门襟、口袋、袖口、衣长、面料视觉；不沿用商品模特的脸 |
| `style` | 光色、构图、美术与质感，不自动当作身份参考 |
| `location` | 无人空间结构、门窗与主光关系 |
| `prop` | 道具几何、材质、状态和必要标记 |
| `start_frame` / `end_frame` | 视频首尾帧；须模型和任务模式明确支持 |

当前 UI 仅提供人像、风格、服装三类上传与视频首帧选择；其他用途为后续扩展。前端当前的单张 8MB、合计 9 张是网页自身限制，不表示所有供应商都支持相同数量、尺寸或 MIME。

素材记录至少包含来源、用途、绑定对象、上传状态、是否实际查看、是否传给生成服务。网页链接只是来源记录，不能声称模型已看到图片。服装检索模块应记录具体商品链接、颜色/款式、查询时间、是否实际看图及可证实的结构；当前没有自动实款检索。

## 5. 标准创作任务

建议 `POST /api/v1/creative-jobs`，使用 `Idempotency-Key` 防止重试创建重复任务。以下字段是 Central.ai 契约，不能原样作为供应商请求体。

```json
{
  "schemaVersion": "1.0.0",
  "projectId": null,
  "mode": "full",
  "theme": "用户原始主题或大纲，完整保留",
  "style": { "name": "用户已选择的风格", "referenceIds": ["ref_style_01"] },
  "duration": 60,
  "ratio": "9:16",
  "references": [
    { "referenceId": "ref_person_01", "purpose": "identity", "characterId": "C001" }
  ],
  "definitions": {
    "characters": [{ "name": "林夏", "description": "用户提供的具体设定" }],
    "locations": [],
    "props": []
  },
  "lockedDialogue": [
    { "id": "D001", "speaker": "林夏", "text": "它还没发生。", "source": "on-screen" }
  ]
}
```

模式语义：`characters` 只请求角色设计与角色图片任务；`props` 只请求关键道具设计与图片任务；`prompts` 仅交付文字，不自动出图；`full` 包含故事、角色、无人场景、道具、分镜与视频提示词，并创建所需图片任务。图片和视频是分开的阶段；创作包完成不自动发送视频生成。

服务端文本模型先返回结构化项目。新创作产生台词后立即建立 `locked_dialogue`；已有剧本保留用户原话、说话人、标点和顺序。不得为了时长自动删词。长对白可以按原字符分片跨镜，拼接结果必须等于原文；无法容纳时返回时长冲突供用户增加时长。

目前 `src/engine.js` 项目使用 `total_seconds`、`aspect_ratio`、`visual_style`、`locked_dialogue`、`assets` 与 `scenes`。API 的 camelCase 输入通过显式映射转换，不能将字段重命名后漏掉锁定数据。`validateProject()` 可用于结构校验；生产服务还应运行独立的服务端验证。验证不通过时不创建图片或视频付费任务。

## 6. 资产图片任务

建议 `POST /api/v1/image-jobs`：

```json
{
  "projectId": "project_01",
  "projectRevision": 3,
  "assetId": "C001",
  "stateId": "C001-W001-BASE",
  "prompt": "已确认的完整人物提示词",
  "aspectRatio": "16:9",
  "references": [
    { "referenceId": "ref_person_01", "purpose": "identity" },
    { "referenceId": "ref_wardrobe_01", "purpose": "wardrobe" }
  ]
}
```

返回异步任务，不返回伪造图片 URL。供应商完成后将真实产物保存到对象存储，记录实际像素、供应商任务 ID、实际提示词、参考素材、模型、生成时间、费用信息（若可取得）和失败原因。不能把商品参考图当作人物资产成品。

基础身份图须视觉通过后才用于后续状态。身份、服装、方向、道具结构或质感失败时，用完整要求和合格基础身份/原始参考重新生成该张；默认首版后最多两轮。不要把失败图连续作为重绘底图。只有实际复看后才能更新视觉结论。最终图像与原稿不同，需回填资产描述和分镜，再重新编译提示词，锁定台词不动。

## 7. 视频请求与供应商适配

当前 `buildVideoDraft()` 输出的 `contract: "central.ai/video-draft"`、`payload`、`warnings` 仅用于本地保存与 JSON 导出。`references` 中只有文件元数据，`referenceUploadStatus: "pending"`；必须重新上传真实文件后才能执行。

接入后建议 `POST /api/v1/video-jobs` 接收草稿 payload，加上 `projectRevision`、已完成上传的 `referenceId`、母场 ID 与子段时间范围。服务端在提交前重新校验当前账户实际能力、任务类型、可用模型、时长、画幅、分辨率、素材数量与声音选项；网页内已核验参数只能作为选择提示。

```typescript
// 建议的适配器接口；当前仓库没有这些实现。
interface VideoAdapter {
  capabilities(context): Promise<Capabilities>;
  prepareReferences(references, context): Promise<ProviderReference[]>;
  submit(normalizedRequest, context): Promise<{ providerJobId: string }>;
  poll(providerJobId, context): Promise<NormalizedJobUpdate>;
  cancel?(providerJobId, context): Promise<NormalizedJobUpdate>;
}
```

Central.ai 的 `modelId` 是目录 ID，未必等于供应商实际模型 ID。不要将 `seedance-2.5`、`runway-gen4.5` 等目录字符串直接当作已开通 endpoint。具体映射、鉴权、API 版本、地域、支持的音频与素材类型留在各适配器内部。停止服务或账户不可用的模型应禁用，不能静默换模型。

`splitSceneForModel()` 保留完整 30 秒母场，只沿原镜头边界拆成支持时长的子段。它不保证所有模型都能拆分成功，也不证明语义、口型或跨段连续性正确。分段无法匹配时返回可操作错误，不补空镜、不改变对白、不偷偷拉长或裁短；后续子段须确认上一段末帧及声音状态。

## 8. 异步任务与真实状态

提交成功仅代表服务端受理：

```json
{
  "jobId": "job_01",
  "kind": "video",
  "status": "queued",
  "submitted": true,
  "projectId": "project_01",
  "projectRevision": 3,
  "statusUrl": "/api/v1/jobs/job_01"
}
```

建议状态：`draft → validating → queued → running → succeeded`，并支持 `partially_succeeded`、`failed`、`cancelled`。供应商结果文件必须实际可读取并绑定到正确项目修订，才可以标记生成 `succeeded`。HTTP 200、202、任务 ID 或本地动画进度都不代表产物已生成。

生成状态和审核状态分别存储：

```json
{
  "generationStatus": "succeeded",
  "artifactId": "artifact_01",
  "review": {
    "structure": "passed",
    "visual": "pending",
    "dialogue": "pending",
    "continuity": "pending"
  }
}
```

只有图片真实返回，才能显示图片预览；只有视频真实返回，才能播放或下载；只有看过成品，才能标记视觉审核通过。文字结构通过不能代替故事质量或视觉验收。全套生成中部分图片失败时显示逐项结果和 `partially_succeeded`，保留成功内容，并只重试失败项。

客户端可以轮询状态，或通过 SSE 接收变化。供应商 webhook 在服务端验证签名、供应商任务 ID 和项目归属，并做幂等处理。任务断线后继续查询原 `jobId`，不自动重建付费任务。项目改动形成新修订；旧任务返回时不能覆盖新设定。

## 9. 错误与重试

建议统一错误结构：

```json
{
  "error": {
    "code": "UNSUPPORTED_COMBINATION",
    "message": "当前模型的此输入模式不支持所选画幅。",
    "retryable": false,
    "field": "ratio",
    "requestId": "request_01"
  }
}
```

参数错误、账户未开通、参考上传缺失、授权失效、余额不足和供应商拒绝应清楚区分。仅临时网络/限流错误可按供应商建议退避重试；重试仍使用原幂等键及任务记录。取消请求不等于供应商已停止计费，前端应以供应商确认的状态为准。

对任意远程素材 URL，由服务端限制协议、来源和文件类型，或优先使用自身对象存储；不将浏览器传来的 URL 无条件作为内部网络请求。服务端重新校验用户权限、素材归属和上传对象，不能依赖前端控件的限制。

## 10. 建议接入验收

- 用真实开发账户验证一条文本任务、一张人物图、一张道具图和一条视频任务，确认供应商任务与 Central.ai 任务对应。
- 覆盖断线恢复、重复提交、取消、部分失败、素材缺失、参数组合不支持及过期任务返回。
- 运行现有结构与模型草稿测试，增加适配器契约测试；测试不得产生未授权的真实付费任务。
- 对真实产物另查身份、服装、无人限制、道具结构、逐字台词与声音/口型、每段连续性。
- 在 API 实际上线前保留“演示 / 未提交”文案；按能力逐项更新，避免整站显示笼统“已接入”。
