export function buildOpenApi(baseUrl = "https://YOUR-RAILWAY-DOMAIN") {
  return {
    openapi: "3.1.0",
    info: {
      title: "Wan2.2 Animate V7 · RunningHub Railway Adapter",
      version: "1.0.0",
      description: "上传角色参考图和动作参考视频，调用 RunningHub Wan2.2 Animate V7 AI 应用并查询输出。"
    },
    servers: [{ url: baseUrl || "https://YOUR-RAILWAY-DOMAIN" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Railway 环境变量 SERVICE_API_TOKEN；未配置时无需认证。" }
      },
      schemas: {
        Status: {
          type: "object",
          properties: {
            taskId: { type: "string" },
            status: { type: "string", enum: ["QUEUED", "RUNNING", "SUCCESS", "FAILED", "PENDING"] },
            done: { type: "boolean" },
            files: { type: "array", items: { type: "object", properties: { fileUrl: { type: "string", format: "uri" } } } }
          }
        }
      }
    },
    paths: {
      "/health": {
        get: { summary: "Railway 健康检查", responses: { "200": { description: "服务正常" } } }
      },
      "/api/wan/info": {
        get: { summary: "查看部署配置（不返回密钥）", security: [{ bearerAuth: [] }], responses: { "200": { description: "配置摘要" } } }
      },
      "/api/wan/nodes": {
        get: { summary: "读取应用当前可编辑节点", security: [{ bearerAuth: [] }], responses: { "200": { description: "nodeInfoList" } } }
      },
      "/api/wan/mapping": {
        get: { summary: "检查自动节点映射；不会创建生成任务", security: [{ bearerAuth: [] }], responses: { "200": { description: "映射与候选节点" } } }
      },
      "/api/wan/start": {
        post: {
          summary: "上传素材并启动 Wan2.2 Animate V7",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["character_image", "motion_video"],
                  properties: {
                    character_image: { type: "string", format: "binary" },
                    motion_video: { type: "string", format: "binary" },
                    prompt: { type: "string" },
                    width: { type: "integer" },
                    height: { type: "integer" },
                    fps: { type: "integer" },
                    pose_strength: { type: "number" },
                    pose_method: { type: "string" },
                    camera_motion: { type: "string" },
                    instance_type: { type: "string" },
                    webhook_url: { type: "string", format: "uri" },
                    node_overrides: { type: "string", description: "JSON 数组，元素含 nodeId、fieldName、fieldValue。" }
                  }
                }
              }
            }
          },
          responses: { "202": { description: "任务已提交" }, "400": { description: "文件或节点映射无效" } }
        }
      },
      "/api/wan/status/{taskId}": {
        get: {
          summary: "查询任务输出",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "taskId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "任务状态",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Status" } }
              }
            }
          }
        }
      },
      "/api/wan/account": {
        get: { summary: "查询 RunningHub 账户状态", security: [{ bearerAuth: [] }], responses: { "200": { description: "RunningHub 原始账户状态" } } }
      }
    }
  };
}
