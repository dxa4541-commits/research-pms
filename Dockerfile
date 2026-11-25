FROM node:22-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production PORT=3000 TRUST_PROXY=1 DB_PATH=/data/app.db UPLOAD_DIR=/data/uploads
VOLUME /data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
