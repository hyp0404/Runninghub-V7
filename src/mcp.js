import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import axios from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod/v4";
import { config, assertRuntimeConfig } from "./config.js";
import { applyRoleValues, resolveNodeMap } from "./node-mapper.js";
import { normalizeOutputs, RunningHubClient } from "./runninghub.js";

let lastGenerationAt = 0;

function runningHub() {
  const missing = assertRuntimeConfig();
  if (missing.length) throw new Error(`服务缺少环境变量：${missing.join(", ")}`);
  return new RunningHubClient({
    baseUrl: config.runningHubBaseUrl,
    apiKey: config.runningHubApiKey,
    timeoutMs: config.requestTimeoutMs
  });
}

function result(data, summary) {
  return {
    structuredContent: data,
    content: [{ type: "text", text: summary || JSON.stringify(data, null, 2) }]
  };
}

function errorResult(error) {
  const message = error?.message || "未知错误";
  const details = error?.details;
  return {
    isError: true,
    structuredContent: { error: message, details },
    content: [{ type: "text", text: details ? `${message}\n${JSON.stringify(details)}` : message }]
  };
}

function isPrivateIp(hostname) {
  if (!net.isIP(hostname)) return false;
  if (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:")) return true;
  const parts = hostname.split(".").map(Number);
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function safeMediaUrl(raw) {
  const url = new URL(raw);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:") throw new Error("素材URL必须使用HTTPS");
  if (hostname === "localhost" || hostname.endsWith(".local") || isPrivateIp(hostname)) {
    throw new Error("素材URL不能指向本机或私有网络");
  }
  return url;
}

function extensionFor(url, contentType, fallback) {
  const ext = path.extname(url.pathname).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  if (contentType?.includes("png")) return ".png";
  if (contentType?.includes("webp")) return ".webp";
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return ".jpg";
  if (contentType?.includes("quicktime")) return ".mov";
  if (contentType?.includes("webm")) return ".webm";
  return fallback;
}

async function downloadMedia(rawUrl, directory, kind) {
  const url = safeMediaUrl(rawUrl);
  const response = await axios.get(url.toString(), {
    responseType: "stream",
    timeout: config.requestTimeoutMs,
    maxRedirects: 3,
    headers: { "User-Agent": "Wan2.2-ChatGPT-MCP/1.1" },
    validateStatus: (status) => status >= 200 && status < 300
  });
  const announced = Number(response.headers["content-length"] || 0);
  if (announced > config.maxUploadBytes) throw new Error(`${kind}素材超过MAX_UPLOAD_MB限制`);

  const extension = extensionFor(url, response.headers["content-type"], kind === "image" ? ".jpg" : ".mp4");
  const filePath = path.join(directory, `${kind}-${crypto.randomUUID()}${extension}`);
  let received = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > config.maxUploadBytes) return callback(new Error(`${kind}素材超过MAX_UPLOAD_MB限制`));
      callback(null, chunk);
    }
  });
  await pipeline(response.data, limiter, fs.createWriteStream(filePath, { flags: "wx" }));
  return { filePath, fileName: path.basename(filePath), bytes: received };
}

function enforceGenerationInterval() {
  const now = Date.now();
  const remaining = config.mcpMinGenerationIntervalMs - (now - lastGenerationAt);
  if (remaining > 0) throw new Error(`生成请求过于频繁，请等待${Math.ceil(remaining / 1000)}秒后重试`);
  lastGenerationAt = now;
}

function createWanMcpServer() {
  const server = new McpServer(
    { name: "runninghub-wan22-animate-v7", version: "1.1.0" },
    {
      instructions: "这是 RunningHub Wan2.2 Animate V7 动作迁移工具。创建任务前应先调用 wan_check_mapping。创建任务需要可公开下载的 HTTPS 角色参考图 URL 和动作参考视频 URL；任务是异步的，提交后使用 wan_get_task 查询，直到 SUCCESS 或 FAILED。"
    }
  );

  server.registerTool(
    "wan_check_mapping",
    {
      title: "检查 Wan V7 节点映射",
      description: "连接 RunningHub 并检查角色图、动作视频和可选参数节点。不会创建任务或消耗生成额度。",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
    },
    async () => {
      try {
        const nodes = await runningHub().getNodeInfoList(config.wanWebappId);
        const mapping = resolveNodeMap(nodes, config.nodeMap);
        return result(
          { webappId: config.wanWebappId, ...mapping },
          mapping.valid ? "Wan V7 必需节点映射有效，可以创建任务。" : `节点映射无效：${mapping.warnings.join("；")}`
        );
      } catch (error) { return errorResult(error); }
    }
  );

  server.registerTool(
    "wan_create_animation",
    {
      title: "创建 Wan V7 动作迁移视频",
      description: "使用角色参考图URL和动作参考视频URL提交一个会消耗RunningHub额度的Wan2.2 Animate V7任务。仅在用户明确要求生成时调用。",
      inputSchema: {
        character_image_url: z.string().url().describe("可由服务器直接下载的HTTPS角色参考图URL"),
        motion_video_url: z.string().url().describe("可由服务器直接下载的HTTPS动作参考视频URL"),
        prompt: z.string().max(4000).optional().describe("画面风格、人物一致性、场景和动作要求"),
        width: z.number().int().min(256).max(2048).optional(),
        height: z.number().int().min(256).max(2048).optional(),
        fps: z.number().int().min(8).max(60).optional(),
        pose_strength: z.number().min(0).max(2).optional(),
        pose_method: z.enum(["vitpose", "sdpose", "scailpos"]).optional(),
        camera_motion: z.boolean().optional(),
        instance_type: z.enum(["default", "plus"]).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false }
    },
    async (input) => {
      let directory;
      try {
        enforceGenerationInterval();
        if (input.width && input.height && input.width * input.height > 1_050_000) {
          throw new Error("宽×高超过约100万像素，可能导致Wan V7显存不足");
        }
        directory = await fsp.mkdtemp(path.join(config.tempDirectory, "mcp-"));
        const rh = runningHub();
        const nodes = await rh.getNodeInfoList(config.wanWebappId);
        const resolved = resolveNodeMap(nodes, config.nodeMap);
        if (!resolved.valid) throw Object.assign(new Error("Wan必需输入节点映射无效，请先调用wan_check_mapping"), { details: resolved });

        const [image, video] = await Promise.all([
          downloadMedia(input.character_image_url, directory, "image"),
          downloadMedia(input.motion_video_url, directory, "video")
        ]);
        const [imageName, videoName] = await Promise.all([
          rh.uploadFile(image.filePath, image.fileName),
          rh.uploadFile(video.filePath, video.fileName)
        ]);
        const nodeInfoList = applyRoleValues(nodes, resolved.mappings, {
          character_image: imageName,
          motion_video: videoName,
          prompt: input.prompt,
          width: input.width,
          height: input.height,
          fps: input.fps,
          pose_strength: input.pose_strength,
          pose_method: input.pose_method,
          camera_motion: input.camera_motion
        });
        const created = await rh.runApp({
          webappId: config.wanWebappId,
          nodeInfoList,
          instanceType: input.instance_type || config.wanInstanceType
        });
        const data = { taskId: String(created.taskId), status: "QUEUED", webappId: config.wanWebappId };
        return result(data, `Wan V7任务已提交，taskId=${data.taskId}。请稍后调用wan_get_task查询结果。`);
      } catch (error) {
        return errorResult(error);
      } finally {
        if (directory) await fsp.rm(directory, { recursive: true, force: true });
      }
    }
  );

  server.registerTool(
    "wan_get_task",
    {
      title: "查询 Wan V7 任务",
      description: "使用taskId查询排队、运行、成功、失败状态；成功时返回可下载的视频URL。",
      inputSchema: { task_id: z.string().min(1).max(100) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
    },
    async ({ task_id }) => {
      try {
        const normalized = normalizeOutputs(await runningHub().outputs(task_id));
        const data = { taskId: task_id, ...normalized };
        const summary = normalized.status === "SUCCESS"
          ? `任务成功。输出：${normalized.files.map((file) => file.fileUrl).join("\n")}`
          : `任务状态：${normalized.status}${normalized.error ? `；${JSON.stringify(normalized.error)}` : ""}`;
        return result(data, summary);
      } catch (error) { return errorResult(error); }
    }
  );

  server.registerTool(
    "wan_account_status",
    {
      title: "检查 RunningHub 账户状态",
      description: "查询当前RunningHub账户余额和并发任务状态，不创建任务。",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
    },
    async () => {
      try {
        const account = await runningHub().accountStatus();
        return result(account, "已读取RunningHub账户状态。具体余额见结构化结果。");
      } catch (error) { return errorResult(error); }
    }
  );

  return server;
}

function sameToken(candidate, expected) {
  const left = Buffer.from(candidate || "");
  const right = Buffer.from(expected || "");
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function mcpAuthorized(req) {
  if (config.mcpAllowNoAuth) return true;
  const bearer = req.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  return sameToken(bearer, config.serviceApiToken);
}

export function registerMcpRoutes(app) {
  app.post("/mcp", async (req, res) => {
    if (!mcpAuthorized(req)) {
      res.status(401).set("WWW-Authenticate", "Bearer").json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "MCP未授权。ChatGPT选择No Auth时，请在Railway设置MCP_ALLOW_NO_AUTH=true。" },
        id: null
      });
      return;
    }
    const server = createWanMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request failed", error);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "MCP服务器错误" }, id: null });
      }
    }
  });

  for (const method of ["get", "delete"]) {
    app[method]("/mcp", (_req, res) => {
      res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
    });
  }
}
