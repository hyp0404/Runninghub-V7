# Wan2.2 Animate V7 · RunningHub Railway Adapter

一套可直接推送到 GitHub、再由 Railway 从仓库部署的 Node.js 20 服务。它不会在 Railway 上运行 Wan 模型；Railway 只负责接收素材、调用 RunningHub AI 应用、返回任务状态与成片 URL，因此 GPU 与生成消耗都发生在 RunningHub。

默认应用 ID：`2050318586283077633`。如果你在 RunningHub 复制了 Wan2.2 Animate V7 应用，请把 `WAN_WEBAPP_ID` 改成复制后的 ID。

## 快速部署

1. 把本目录全部文件提交到一个 GitHub 仓库。
2. Railway 选择 **New Project → Deploy from GitHub repo**，授权并选中该仓库。
3. 在 Railway 服务的 **Variables** 中至少设置：

   ```text
   RUNNINGHUB_API_KEY=你的RunningHub_API_Key
   WAN_WEBAPP_ID=2050318586283077633
   SERVICE_API_TOKEN=自定义的长随机字符串
   ```

4. Railway 会读取 `railway.json`，用 `Dockerfile` 构建，并以 `/health` 作为健康检查。
5. 在 **Settings → Networking → Public Networking** 生成公网域名；可再添加 `PUBLIC_BASE_URL=https://你的域名`。
6. 首次部署先访问节点映射检查接口：

   ```bash
   curl -H "Authorization: Bearer 你的SERVICE_API_TOKEN" \
     https://你的域名/api/wan/mapping
   ```

   `valid: true` 可直接生成；若为 `false`，按 [DEPLOYMENT_GUIDE_CN.md](DEPLOYMENT_GUIDE_CN.md) 的“节点映射”配置 `WAN_NODE_MAP_JSON`。

## 调用示例

启动任务：

```bash
curl -X POST "https://你的域名/api/wan/start" \
  -H "Authorization: Bearer 你的SERVICE_API_TOKEN" \
  -F "character_image=@./character.png" \
  -F "motion_video=@./fight-reference.mp4" \
  -F "prompt=古风写实电影质感，角色外观一致，剑术动作连贯，稳定镜头" \
  -F "width=1280" \
  -F "height=720" \
  -F "fps=24"
```

返回 `taskId` 后查询：

```bash
curl -H "Authorization: Bearer 你的SERVICE_API_TOKEN" \
  "https://你的域名/api/wan/status/返回的taskId"
```

状态可能为 `QUEUED`、`RUNNING`、`SUCCESS`、`FAILED`。成功时 `files[].fileUrl` 是 RunningHub 输出地址。

## 接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/health` | Railway 健康检查 |
| GET | `/openapi.json` | 按当前域名动态生成的 OpenAPI |
| GET | `/api/wan/info` | 查看非敏感部署配置 |
| GET | `/api/wan/nodes` | 查看应用当前可编辑节点 |
| GET | `/api/wan/mapping` | 检查节点映射，不创建生成任务 |
| POST | `/api/wan/start` | 上传角色图、动作视频并创建任务 |
| GET | `/api/wan/status/:taskId` | 查询任务输出 |
| GET | `/api/wan/account` | 查询 RunningHub 账户状态 |

完整变量、节点映射、Railway 操作和排错见 [DEPLOYMENT_GUIDE_CN.md](DEPLOYMENT_GUIDE_CN.md)。

## 安全说明

- `.env` 已被 Git 忽略；不要把真实 `RUNNINGHUB_API_KEY` 提交到 GitHub。
- 建议一定设置 `SERVICE_API_TOKEN`。未设置时 `/api/*` 将公开可调用，可能消耗你的 RH 余额。
- 上传文件只临时保存在 Railway 容器的 `/tmp`，传入 RunningHub 后立即删除。
- Railway 不需要持久卷，也不需要 GPU。

## 官方资料

- RunningHub AI 应用 API 文档：<https://www.runninghub.cn/runninghub-api-doc-cn/doc-8287339>
- Wan2.2 Animate V7 应用页：<https://www.runninghub.cn/ai-detail/2050318586283077633>
