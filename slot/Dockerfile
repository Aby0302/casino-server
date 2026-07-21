FROM node:20-slim

WORKDIR /app

# System dependencies for Playwright Chromium
RUN apt-get update --allow-unauthenticated -o Acquire::AllowInsecureRepositories=true && apt-get install -y --no-install-recommends --allow-unauthenticated debian-archive-keyring && apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  libnss3 \
  libnspr4 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libdbus-1-3 \
  libxkbcommon0 \
  libxdamage1 \
  libxfixes3 \
  libxcomposite1 \
  libxrandr2 \
  libgbm1 \
  libpango-1.0-0 \
  libcairo2 \
  libasound2 \
  libegl1 \
  libgles2 \
  libx11-xcb1 \
  && rm -rf /var/lib/apt/lists/*

# Copy package files first for layer caching
COPY package.json package-lock.json ./
RUN npm ci --only=production && npx playwright install chromium

# Copy source
COPY . .

# Data directory for player persistence
RUN mkdir -p data

EXPOSE 3001

ENV NODE_ENV=production
ENV ADMIN_PASSWORD=""

CMD ["node", "server.js"]
