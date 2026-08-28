FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# 复制仓库中实际存在的文件，避免可选的 config 目录未上传时构建失败。
COPY . .

USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
