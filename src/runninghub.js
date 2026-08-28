import fs from "node:fs";
import axios from "axios";
import FormData from "form-data";
import { HttpError } from "./http-error.js";

export class RunningHubClient {
  constructor({ baseUrl, apiKey, timeoutMs }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.http = axios.create({ baseURL: baseUrl, timeout: timeoutMs, maxBodyLength: Infinity, maxContentLength: Infinity });
  }

  headers(extra = {}) {
    return { Authorization: `Bearer ${this.apiKey}`, ...extra };
  }

  async request(action) {
    try {
      const response = await action();
      return response.data;
    } catch (error) {
      const status = error.response?.status || 502;
      const details = error.response?.data || error.message;
      throw new HttpError(status, "RunningHub请求失败", details);
    }
  }

  async getNodeInfoList(webappId) {
    const data = await this.request(() => this.http.get("/api/webapp/apiCallDemo", {
      params: { apiKey: this.apiKey, webappId },
      headers: this.headers()
    }));
    if (data?.code !== 0 || !Array.isArray(data?.data?.nodeInfoList)) {
      throw new HttpError(502, "无法读取Wan应用nodeInfoList", data);
    }
    return data.data.nodeInfoList;
  }

  async uploadFile(filePath, originalName) {
    const form = new FormData();
    form.append("apiKey", this.apiKey);
    form.append("fileType", "input");
    form.append("file", fs.createReadStream(filePath), { filename: originalName });
    const data = await this.request(() => this.http.post("/task/openapi/upload", form, {
      headers: this.headers(form.getHeaders())
    }));
    const fileName = data?.data?.fileName;
    if (data?.code !== 0 || !fileName) throw new HttpError(502, "上传素材到RunningHub失败", data);
    return fileName;
  }

  async runApp({ webappId, nodeInfoList, instanceType, webhookUrl }) {
    const payload = { webappId: Number(webappId), apiKey: this.apiKey, nodeInfoList, instanceType };
    if (webhookUrl) payload.webhookUrl = webhookUrl;
    const data = await this.request(() => this.http.post("/task/openapi/ai-app/run", payload, {
      headers: this.headers({ "Content-Type": "application/json" })
    }));
    if (data?.code !== 0 || !data?.data?.taskId) throw new HttpError(502, "Wan任务提交失败", data);
    return data.data;
  }

  async outputs(taskId) {
    return this.request(() => this.http.post("/task/openapi/outputs", {
      apiKey: this.apiKey,
      taskId: String(taskId)
    }, { headers: this.headers({ "Content-Type": "application/json" }) }));
  }

  async accountStatus() {
    return this.request(() => this.http.post("/uc/openapi/accountStatus", {
      apikey: this.apiKey
    }, { headers: this.headers({ "Content-Type": "application/json" }) }));
  }
}

export function normalizeOutputs(result) {
  const code = result?.code;
  if (code === 0 && Array.isArray(result.data) && result.data.length) {
    return {
      status: "SUCCESS",
      done: true,
      files: result.data.map((item) => ({ fileUrl: item.fileUrl, fileType: item.fileType, nodeId: item.nodeId })).filter((item) => item.fileUrl),
      raw: result.data
    };
  }
  if (code === 804) return { status: "RUNNING", done: false, files: [] };
  if (code === 813) return { status: "QUEUED", done: false, files: [] };
  if (code === 805) return { status: "FAILED", done: true, files: [], error: result.data?.failedReason || result.msg || result.data };
  return { status: "PENDING", done: false, files: [], code, message: result?.msg, raw: result?.data };
}
