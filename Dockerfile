# Self-hosted Jarvis endpoint: Caddy (garganacl) terminates HTTPS and proxies here.
FROM node:22-alpine
WORKDIR /app
COPY lambda/package.json lambda/package-lock.json ./
RUN npm ci --omit=dev
COPY lambda/ ./
USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server.js"]
