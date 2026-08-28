# Wan2.2 Animate V7：ChatGPT MCP、GitHub 与 Railway 部署手册

## 1. 这套部署实际做什么

调用链是：

```text
你的前端/剪辑程序 → Railway API 服务 → RunningHub Wan2.2 Animate V7 → 输出视频 URL
```

Railway 不是 GPU 推理机，也不安装 ComfyUI 或 Wan2.2 权重。它是 API/MCP 中转层：隐藏 RunningHub API Key、接收参考图和动作视频、读取应用节点、提交任务、轮询输出。生成任务仍消耗 RunningHub 的 RH/算力。

这个设计尤其适合你当前的打斗视频流程：先把一场 90 秒戏拆成多个 6–10 秒动作段，每段用角色图和动作参考视频驱动，最后在剪辑软件中统一节奏、色彩和配乐。

## 2. 文件结构

```text
.
├── .dockerignore
├── .env.example
├── .gitignore
├── .github/workflows/ci.yml
├── Dockerfile
├── railway.json
├── package.json
├── openapi.yaml
├── README.md
├── DEPLOYMENT_GUIDE_CN.md
├── config/
│   └── wan-node-map.example.json
├── src/
│   ├── config.js
│   ├── http-error.js
│   ├── mcp.js
│   ├── node-mapper.js
│   ├── openapi.js
│   ├── runninghub.js
│   └── server.js
└── test/
    └── node-mapper.test.js
```

关键文件：

- `Dockerfile`：Railway 的可重复构建环境，使用 Node.js 20。
- `.github/workflows/ci.yml`：每次推送后自动执行安装、测试与语法检查。
- `railway.json`：指定 Dockerfile 构建、启动命令、健康检查和失败重启。
- `src/runninghub.js`：上传素材、提交 AI 应用、查询输出。
- `src/node-mapper.js`：从应用当前的 `nodeInfoList` 自动识别角色图、动作视频等字段。
- `src/mcp.js`：为 ChatGPT 提供 `/mcp` Streamable HTTP 端点与 Wan 工具。
- `config/wan-node-map.example.json`：自动识别不唯一时的显式映射示例。

## 3. 上传到 GitHub

### 方法 A：网页上传

1. GitHub 新建一个空仓库，例如 `wan22-animate-v7-api`。
2. 进入仓库后选择 **Add file → Upload files**。
3. 上传本项目目录里的全部文件和目录，而不是只上传 ZIP。
4. 提交时确认仓库中能直接看到 `Dockerfile`、`railway.json`、`package.json` 和 `src/`。

### 方法 B：Git 命令

```bash
git init
git add .
git commit -m "Deploy Wan2.2 Animate V7 RunningHub adapter"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库.git
git push -u origin main
```

不要创建或提交包含真实密钥的 `.env`。Railway 的密钥只写在 Variables 中。

## 4. Railway 部署

1. 登录 Railway，选择 **New Project**。
2. 选择 **Deploy from GitHub repo**，授权 Railway 读取目标仓库。
3. 选中刚上传的仓库。Railway 会识别根目录的 `railway.json` 和 `Dockerfile`。
4. 在新服务中进入 **Variables**，先添加必需变量。
5. 进入 **Settings → Networking → Public Networking**，点击生成域名。
6. 等待 Deploy 状态变为成功；访问 `https://你的域名/health`。

健康响应应类似：

```json
{"ok":true,"service":"wan22-animate-v7-runninghub","missing":[]}
```

若 `RUNNINGHUB_API_KEY` 未设置，健康检查会返回 503，并明确列出缺失变量。设置后 Railway 会自动重新部署。

## 5. Railway 环境变量

| 变量 | 必需 | 建议值 | 说明 |
|---|---:|---|---|
| `RUNNINGHUB_API_KEY` | 是 | RunningHub 控制台生成 | 只放 Railway Variables，不进 GitHub |
| `WAN_WEBAPP_ID` | 是 | `2050318586283077633` | 公共 V7 应用 ID；复制应用后换成你的 ID |
| `RUNNINGHUB_BASE_URL` | 否 | `https://www.runninghub.cn` | RunningHub 中国站 API 根地址 |
| `WAN_INSTANCE_TYPE` | 否 | `default` | 默认实例；需要 48G 时按账户和接口支持改为 `plus` |
| `SERVICE_API_TOKEN` | 强烈建议 | 32 位以上随机串 | 保护 `/api/*`，调用时用 Bearer Token |
| `MCP_ALLOW_NO_AUTH` | ChatGPT No Auth 必需 | `true` | 允许 ChatGPT 无认证初始化 `/mcp`；仅建议个人测试 |
| `MCP_MIN_GENERATION_INTERVAL_SECONDS` | 否 | `30` | 匿名 MCP 创建生成任务的最短间隔 |
| `PUBLIC_BASE_URL` | 否 | `https://xxx.up.railway.app` | 用于返回状态 URL 与动态 OpenAPI |
| `MAX_UPLOAD_MB` | 否 | `500` | 每个上传文件的大小上限 |
| `RUNNINGHUB_TIMEOUT_MS` | 否 | `180000` | 单次 RunningHub HTTP 请求超时；不是生成总时长 |
| `CORS_ORIGINS` | 否 | `https://你的前端域名` | 多个来源用逗号分隔；留空允许所有来源 |
| `WAN_NODE_MAP_JSON` | 条件必需 | 见下一节 | 自动识别失败或应用升级后显式指定节点 |
| `WAN_NODE_MAP_FILE` | 否 | `config/xxx.json` | 本地映射文件，与 JSON 环境变量二选一 |

建议用密码生成器产生 `SERVICE_API_TOKEN`，不要使用 RunningHub API Key 作为服务访问令牌。

## 6. 在 ChatGPT 创建 WINV7 App

先确认 GitHub/Railway 已部署 v1.1.0，并在 Railway Variables 新增：

```text
MCP_ALLOW_NO_AUTH=true
MCP_MIN_GENERATION_INTERVAL_SECONDS=30
```

访问健康检查：

```text
https://你的域名/health
```

必须能看到：

```json
{
  "ok": true,
  "version": "1.1.0",
  "mcp": {"endpoint":"/mcp","noAuthenticationEnabled":true}
}
```

然后在 ChatGPT 开发者模式中创建 App：

```text
Name: WINV7
Description: RunningHub Wan2.2 Animate V7 动作迁移与任务查询
Connection: Server URL
Server URL: https://你的Railway域名/mcp
Authentication: No Auth
```

勾选风险确认后点击 Create。连接成功应扫描到四个工具：

| 工具 | 作用 | 是否消耗生成额度 |
|---|---|---:|
| `wan_check_mapping` | 检查 V7 当前节点 | 否 |
| `wan_create_animation` | 从角色图 URL 和动作视频 URL 创建任务 | 是 |
| `wan_get_task` | 查询任务和输出 URL | 否 |
| `wan_account_status` | 查询账户状态 | 否 |

注意：`/mcp` 是 MCP POST 端点，直接在浏览器地址栏打开会得到 405，这是正常的；浏览器健康检查请使用 `/health`。

### ChatGPT 素材限制

当前无 UI 的 MCP 工具接收 HTTPS 素材 URL。角色图片和动作视频必须能被 Railway 直接下载。本地附件、`sandbox:` 地址、电脑磁盘路径不能直接传给 Railway。如果 ChatGPT 没有提供可下载 URL，请先上传到对象存储或其他能生成短期签名 HTTPS URL 的位置。

### No Auth 风险

`MCP_ALLOW_NO_AUTH=true` 意味着知道 `/mcp` 地址的人可能调用生成工具并消耗 RH。当前增加了最短生成间隔，但它不等于身份认证。个人测试完成后，如果准备分享或发布 App，应升级到 OAuth 2.1，而不是长期公开 No Auth。

## 7. 首次部署的节点映射

RunningHub AI 应用的节点 ID 会随应用复制、作者升级或工作流修改而变化，因此项目不把角色图和动作视频的节点 ID 写死。这也是本项目与普通“一次性脚本”的主要区别。

先执行：

```bash
curl -H "Authorization: Bearer 你的SERVICE_API_TOKEN" \
  https://你的域名/api/wan/mapping
```

这个请求只读取可编辑节点，不会启动 Wan 生成任务。如果返回：

```json
{
  "valid": true,
  "mappings": {
    "character_image": {"nodeId":"123","fieldName":"image","source":"automatic"},
    "motion_video": {"nodeId":"456","fieldName":"video","source":"automatic"}
  }
}
```

说明可以直接调用 `/api/wan/start`。

如果 `valid` 为 `false`，查看响应中的 `candidates`，或访问：

```bash
curl -H "Authorization: Bearer 你的SERVICE_API_TOKEN" \
  https://你的域名/api/wan/nodes
```

找到角色参考图和动作参考视频的真实 `nodeId`、`fieldName`，在 Railway 添加单行 JSON：

```text
WAN_NODE_MAP_JSON={"character_image":{"nodeId":"角色图节点ID","fieldName":"image"},"motion_video":{"nodeId":"动作视频节点ID","fieldName":"video"}}
```

也可以继续指定可选字段：

```json
{
  "character_image": {"nodeId":"100","fieldName":"image"},
  "motion_video": {"nodeId":"200","fieldName":"video"},
  "prompt": {"nodeId":"300","fieldName":"text"},
  "width": {"nodeId":"400","fieldName":"width"},
  "height": {"nodeId":"400","fieldName":"height"},
  "fps": {"nodeId":"500","fieldName":"fps"},
  "pose_strength": {"nodeId":"600","fieldName":"strength"},
  "pose_method": {"nodeId":"700","fieldName":"method"},
  "camera_motion": {"nodeId":"800","fieldName":"enabled"}
}
```

必须使用 `/api/wan/nodes` 返回的原值，不要照抄示例数字。保存 Railway 变量并重新部署后，再检查 `/api/wan/mapping`。

## 8. 创建生成任务

最小请求：

```bash
curl -X POST "https://你的域名/api/wan/start" \
  -H "Authorization: Bearer 你的SERVICE_API_TOKEN" \
  -F "character_image=@./character.png" \
  -F "motion_video=@./motion.mp4"
```

包含常用参数：

```bash
curl -X POST "https://你的域名/api/wan/start" \
  -H "Authorization: Bearer 你的SERVICE_API_TOKEN" \
  -F "character_image=@./xihmen.png" \
  -F "motion_video=@./sword-fight-01.mp4" \
  -F "prompt=古风写实武侠电影，雪夜紫禁之巅，白衣剑客，角色脸部和服装一致，双人剑招清晰连贯，稳定跟拍" \
  -F "width=1280" \
  -F "height=720" \
  -F "fps=24" \
  -F "pose_strength=1.0" \
  -F "pose_method=vitpose" \
  -F "camera_motion=false"
```

返回：

```json
{
  "taskId": "1234567890",
  "status": "QUEUED",
  "statusUrl": "https://你的域名/api/wan/status/1234567890",
  "mappings": {}
}
```

`width`、`height`、`fps` 等参数只有在当前应用暴露了相应可编辑节点且映射成功时才会写入；否则维持应用页面中保存的默认值。

对于未内置的 V7 参数，可用 `node_overrides` 精确覆盖：

```bash
-F 'node_overrides=[{"nodeId":"123","fieldName":"某字段","fieldValue":"某值"}]'
```

仍须先从 `/api/wan/nodes` 获取真实节点和字段。

## 9. 查询进度和结果

```bash
curl -H "Authorization: Bearer 你的SERVICE_API_TOKEN" \
  https://你的域名/api/wan/status/任务ID
```

统一状态含义：

| 状态 | 含义 | 建议 |
|---|---|---|
| `QUEUED` | RunningHub 排队中 | 30–60 秒后重试 |
| `RUNNING` | 正在生成 | 30–60 秒后重试 |
| `SUCCESS` | 已成功 | 下载 `files[].fileUrl` |
| `FAILED` | 生成失败 | 查看 `error`，再查 RunningHub 任务记录 |
| `PENDING` | 其他暂态/未识别响应 | 稍后重试并保留原始信息排错 |

不要以 1–2 秒频率轮询。动作视频生成通常耗时较长，建议每 30–60 秒查询一次，前端设置 20–40 分钟的任务级超时，而不是把一次 HTTP 请求一直挂住。

## 10. 打斗视频的输入建议

为解决背景跳变和动作断裂，部署只是一部分，素材组织更重要：

1. 每次生成控制在 6–10 秒，一个片段只完成一个明确动作单元，例如“拔剑—突刺—格挡”。
2. 先制作连贯的动作参考视频，再让角色图迁移动作；不要只靠文字描述复杂双人对打。
3. 相邻片段复用同一套角色定妆图、场景基准图、画幅、镜头高度和光向。
4. 720p 先试，建议 `1280×720 / 24fps`；稳定后再提高画质。
5. 参考视频尽量人物无遮挡、四肢完整、动作速度不过快；双人交错遮挡越多，姿态跟踪越容易失稳。
6. 片段结尾保留 8–16 帧稳定姿势，下一段从相近姿势开始，剪辑时用动作匹配点衔接。
7. 运镜与人物动作分开控制。先用固定或轻跟拍镜头获得动作连贯性，再在剪辑阶段加推拉摇移。
8. 90 秒成片建议生成 12–16 个短片段，最后统一调色、环境声、剑鸣和配乐。

## 11. 常见故障

### `/health` 返回 503

检查 Railway Variables 中是否有 `RUNNINGHUB_API_KEY`。变量名区分大小写。

### 接口返回 401

请求头必须是：

```text
Authorization: Bearer 你的SERVICE_API_TOKEN
```

### 节点映射失败

应用节点发生变化。访问 `/api/wan/nodes`，更新 `WAN_NODE_MAP_JSON`。不要修改源代码中的默认 ID。

### RunningHub 返回排队或运行中

这是正常异步状态。继续通过 `/api/wan/status/:taskId` 轮询，不要重复提交相同任务。

### RunningHub 返回失败

常见原因包括余额/算力不足、输入格式或分辨率不合适、应用作者升级后参数变化。先在 RunningHub 网页中用同一素材运行一次，再对照 `/api/wan/nodes`。

### 上传太大或 Railway 请求中断

压缩动作参考视频，或提高 `MAX_UPLOAD_MB`。较大的公网上传也可能受到客户端或 Railway 套餐限制；生产环境可扩展为对象存储直传，但当前版本刻意保持部署简单。

### Railway 部署成功但没有公网地址

到服务的 **Settings → Networking** 手动生成域名。Railway 项目创建成功不等于自动启用公网域名。

### GitHub 更新后 Railway 没有更新

确认 Railway 服务连接的是正确仓库和分支，并在 Deployments 中查看最新提交；必要时点击 Redeploy。

### Docker 构建提示 `"/config": not found`

这是旧版 `Dockerfile` 单独执行 `COPY config ./config`，但 GitHub 仓库没有上传 `config` 目录造成的。v1.0.1 已改成 `COPY . .`，不再依赖可选目录。把新版 `Dockerfile` 覆盖到仓库根目录，提交后重新部署即可。

### ChatGPT 显示 `Error creating connector`

先打开 `/health` 确认版本是 `1.1.0`，且 `noAuthenticationEnabled` 为 `true`。旧版只有 REST API，没有 `/mcp`，即使地址写成 `/mcp` 也一定创建失败。确认 GitHub 中存在 `src/mcp.js`，`package.json` 中存在 `@modelcontextprotocol/sdk` 和 `zod`，Railway 重新部署后再创建。

## 12. 本地验证

```bash
cp .env.example .env
npm install
npm test
RUNNINGHUB_API_KEY=你的Key SERVICE_API_TOKEN=测试Token npm start
```

另一个终端访问：

```bash
curl http://localhost:3000/health
curl -H "Authorization: Bearer 测试Token" http://localhost:3000/api/wan/mapping
```

## 13. 升级策略

- 如果只是应用节点变动：优先更新 Railway 的 `WAN_NODE_MAP_JSON`，不必改 GitHub 源码。
- 如果你复制或魔改了应用：修改 `WAN_WEBAPP_ID`，重新检查映射。
- 如果 RunningHub API 路径或响应结构变动：修改 `src/runninghub.js` 并重新部署。
- 修改 GitHub 主分支后，Railway 默认会自动构建新版本；先查看构建日志和 `/health`，再切换业务调用。

官方参考：

- RunningHub AI 应用 API 文档：<https://www.runninghub.cn/runninghub-api-doc-cn/doc-8287339>
- Wan2.2 Animate V7 应用页：<https://www.runninghub.cn/ai-detail/2050318586283077633>
