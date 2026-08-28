import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, "..");

function integer(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

function boolean(name, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function loadNodeMap() {
  if (process.env.WAN_NODE_MAP_JSON?.trim()) {
    return JSON.parse(process.env.WAN_NODE_MAP_JSON);
  }
  if (process.env.WAN_NODE_MAP_FILE?.trim()) {
    const filePath = path.isAbsolute(process.env.WAN_NODE_MAP_FILE)
      ? process.env.WAN_NODE_MAP_FILE
      : path.join(projectRoot, process.env.WAN_NODE_MAP_FILE);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }
  return {};
}

const baseUrl = (process.env.RUNNINGHUB_BASE_URL || "https://www.runninghub.cn").replace(/\/$/, "");

export const config = {
  port: integer("PORT", 3000),
  runningHubApiKey: process.env.RUNNINGHUB_API_KEY?.trim() || "",
  runningHubBaseUrl: baseUrl,
  wanWebappId: process.env.WAN_WEBAPP_ID?.trim() || "2050318586283077633",
  wanInstanceType: process.env.WAN_INSTANCE_TYPE?.trim() || "default",
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, ""),
  serviceApiToken: process.env.SERVICE_API_TOKEN?.trim() || "",
  mcpAllowNoAuth: boolean("MCP_ALLOW_NO_AUTH", false),
  mcpMinGenerationIntervalMs: integer("MCP_MIN_GENERATION_INTERVAL_SECONDS", 30) * 1000,
  maxUploadBytes: integer("MAX_UPLOAD_MB", 500) * 1024 * 1024,
  requestTimeoutMs: integer("RUNNINGHUB_TIMEOUT_MS", 180000),
  corsOrigins: (process.env.CORS_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean),
  nodeMap: loadNodeMap(),
  tempDirectory: "/tmp/wan22-uploads"
};

export function assertRuntimeConfig() {
  const missing = [];
  if (!config.runningHubApiKey) missing.push("RUNNINGHUB_API_KEY");
  if (!config.wanWebappId) missing.push("WAN_WEBAPP_ID");
  return missing;
}
