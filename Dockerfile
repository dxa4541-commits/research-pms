FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
# Database: DATABASE_URL (Supabase).  Files: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (Supabase Storage).
# Without them the app falls back to an embedded database and a local folder under /data (needs a persistent disk).
ENV NODE_ENV=production PORT=3000 TRUST_PROXY=1 DB_PATH=/data/pgdata UPLOAD_DIR=/data/uploads
EXPOSE 3000
CMD ["node", "server.js"]
