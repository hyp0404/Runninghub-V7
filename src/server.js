import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import cors from "cors";
import express from "express";
import multer from "multer";
import { config, assertRuntimeConfig } from "./config.js";
import { HttpError } from "./http-error.js";
import { applyRawOverrides, applyRoleValues, publicNode, resolveNodeMap } from "./node-mapper.js";
import { buildOpenApi } from "./openapi.js";
import { registerMcpRoutes } from "./mcp.js";
import { normalizeOutputs, RunningHubClient } from "./runninghub.js";

await fs.mkdir(config.tempDirectory, { recursive: true });

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || !config.corsOrigins.length || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new HttpError(403, "该来源不在CORS_ORIGINS白名单中"));
  }
}));

const storage = multer.diskStorage({
  destination: config.tempDirectory,
  filename(_req, file, callback) {
    const extension = path.extname(file.originalname).slice(0, 12);
    callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  }
});
const upload = multer({ storage, limits: { fileSize: config.maxUploadBytes, files: 2 } });

function publicUrl(req) {
  return config.publicBaseUrl || `${req.protocol}://${req.get("host")}`;
}

function authenticate(req, _res, next) {
  if (!config.serviceApiToken) return next();
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "") || req.get("x-api-key") || "";
  const left = Buffer.from(token);
  const right = Buffer.from(config.serviceApiToken);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return next(new HttpError(401, "服务访问令牌无效"));
  next();
}

function client() {
  const missing = assertRuntimeConfig();
  if (missing.length) throw new HttpError(503, `服务缺少环境变量：${missing.join(", ")}`);
  return new RunningHubClient({
    baseUrl: config.runningHubBaseUrl,
    apiKey: config.runningHubApiKey,
    timeoutMs: config.requestTimeoutMs
  });
}

function parseOverrides(value) {
  if (!value) return [];
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HttpError(400, "node_overrides必须是有效JSON数组");
  }
  if (!Array.isArray(parsed) || parsed.some((item) => !item?.nodeId || !item?.fieldName || item.fieldValue === undefined)) {
    throw new HttpError(400, "node_overrides每项必须包含nodeId、fieldName、fieldValue");
  }
  return parsed;
}

async function cleanupFiles(files = {}) {
  const entries = Object.values(files).flat();
  await Promise.allSettled(entries.map((file) => fs.unlink(file.path)));
}

app.get("/health", (_req, res) => {
  const missing = assertRuntimeConfig();
  res.status(missing.length ? 503 : 200).json({
    ok: !missing.length,
    service: "wan22-animate-v7-runninghub-mcp",
    version: "1.1.0",
    mcp: { endpoint: "/mcp", noAuthenticationEnabled: config.mcpAllowNoAuth },
    missing
  });
});

app.get("/openapi.json", (req, res) => res.json(buildOpenApi(publicUrl(req))));

registerMcpRoutes(app);

app.use("/api", authenticate);

app.get("/api/wan/info", (_req, res) => {
  res.json({
    webappId: config.wanWebappId,
    runningHubBaseUrl: config.runningHubBaseUrl,
    instanceType: config.wanInstanceType,
    maxUploadMB: Math.floor(config.maxUploadBytes / 1024 / 1024),
    authenticationEnabled: Boolean(config.serviceApiToken),
    explicitMappingRoles: Object.keys(config.nodeMap)
  });
});

app.get("/api/wan/nodes", async (_req, res, next) => {
  try {
    const nodes = await client().getNodeInfoList(config.wanWebappId);
    res.json({ webappId: config.wanWebappId, count: nodes.length, nodes: nodes.map(publicNode) });
  } catch (error) { next(error); }
});

app.get("/api/wan/mapping", async (_req, res, next) => {
  try {
    const nodes = await client().getNodeInfoList(config.wanWebappId);
    const result = resolveNodeMap(nodes, config.nodeMap);
    res.json({ webappId: config.wanWebappId, ...result, note: "该接口只检查节点，不会创建生成任务或消耗生成额度。" });
  } catch (error) { next(error); }
});

app.post(
  "/api/wan/start",
  upload.fields([{ name: "character_image", maxCount: 1 }, { name: "motion_video", maxCount: 1 }]),
  async (req, res, next) => {
    try {
      const image = req.files?.character_image?.[0];
      const video = req.files?.motion_video?.[0];
      if (!image || !video) throw new HttpError(400, "character_image和motion_video两个文件都必须上传");

      const rh = client();
      const nodes = await rh.getNodeInfoList(config.wanWebappId);
      const resolved = resolveNodeMap(nodes, config.nodeMap);
      if (!resolved.valid) {
        throw new HttpError(400, "无法安全确定Wan输入节点，请先访问/api/wan/mapping并配置WAN_NODE_MAP_JSON", {
          warnings: resolved.warnings,
          candidates: resolved.candidates
        });
      }

      const [imageName, videoName] = await Promise.all([
        rh.uploadFile(image.path, image.originalname),
        rh.uploadFile(video.path, video.originalname)
      ]);
      const values = {
        character_image: imageName,
        motion_video: videoName,
        prompt: req.body.prompt,
        width: req.body.width,
        height: req.body.height,
        fps: req.body.fps,
        pose_strength: req.body.pose_strength,
        pose_method: req.body.pose_method,
        camera_motion: req.body.camera_motion
      };
      let nodeInfoList = applyRoleValues(nodes, resolved.mappings, values);
      nodeInfoList = applyRawOverrides(nodeInfoList, parseOverrides(req.body.node_overrides));
      const result = await rh.runApp({
        webappId: config.wanWebappId,
        nodeInfoList,
        instanceType: req.body.instance_type || config.wanInstanceType,
        webhookUrl: req.body.webhook_url
      });
      res.status(202).json({
        taskId: String(result.taskId),
        status: "QUEUED",
        statusUrl: `${publicUrl(req)}/api/wan/status/${result.taskId}`,
        mappings: resolved.mappings
      });
    } catch (error) {
      next(error);
    } finally {
      await cleanupFiles(req.files);
    }
  }
);

app.get("/api/wan/status/:taskId", async (req, res, next) => {
  try {
    const result = await client().outputs(req.params.taskId);
    res.json({ taskId: String(req.params.taskId), ...normalizeOutputs(result) });
  } catch (error) { next(error); }
});

app.get("/api/wan/account", async (_req, res, next) => {
  try { res.json(await client().accountStatus()); } catch (error) { next(error); }
});

app.use((_req, _res, next) => next(new HttpError(404, "接口不存在")));
app.use((error, _req, res, _next) => {
  const status = error instanceof multer.MulterError ? 400 : (error.status || 500);
  const message = error instanceof multer.MulterError ? `文件上传失败：${error.message}` : (error.message || "服务器错误");
  if (status >= 500) console.error(error);
  res.status(status).json({ error: message, details: error.details });
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Wan2.2 Animate V7 adapter listening on :${config.port}`);
});
