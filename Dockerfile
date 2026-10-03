FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json
RUN npm ci

COPY api/tsconfig.json api/tsconfig.json
COPY api/src api/src
COPY api/test api/test
RUN npm run build -w api && npm run test -w api

CMD ["npm", "run", "start", "-w", "api"]
