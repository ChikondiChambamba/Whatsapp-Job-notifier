FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist ./dist
COPY web-dist ./web-dist

# Listen on all interfaces inside the container; docker-compose publishes the
# port on the host's loopback only (127.0.0.1:4000).
ENV LISTEN_HOST=0.0.0.0

VOLUME ["/app/auth_session", "/app/data", "/app/logs"]
EXPOSE 4000

CMD ["node", "dist/index.js"]
