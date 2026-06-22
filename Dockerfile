# AI DJ - long-running Node server that shells out to yt-dlp and serves the built SPA.
FROM node:20-slim

# yt-dlp needs python3 + ffmpeg; ca-certificates/curl to fetch the binary.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 curl ca-certificates \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install server deps first (better layer caching).
COPY package*.json ./
RUN npm install --omit=dev

# App source + frontend, then build the SPA into frontend/dist.
COPY . .
RUN npm run build

# Audio cache lives on a mounted volume in production.
ENV NODE_ENV=production
ENV PORT=3000
ENV CACHE_DIR=/data/cache
RUN mkdir -p /data/cache

EXPOSE 3000
CMD ["node", "server.js"]
