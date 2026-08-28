FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY config ./config
COPY openapi.yaml README.md DEPLOYMENT_GUIDE_CN.md ./

USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
