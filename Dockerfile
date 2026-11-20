FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist ./dist
COPY web-dist ./web-dist

VOLUME ["/app/auth_session", "/app/data"]
EXPOSE 4000

CMD ["node", "dist/index.js"]
