FROM node:20-slim

WORKDIR /app

# System dependencies for Playwright Chromium
# This layer is cached as long as this RUN command doesn't change
RUN apt-get update && apt-get install -y --no-install-recommends \
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

# Copy package files first (changes rarely) for layer caching
COPY package.json package-lock.json ./
RUN npm ci --only=production && npx playwright install chromium

# Copy source last (changes most often)
COPY . .

RUN mkdir -p data

EXPOSE 3001

ENV NODE_ENV=production
ENV ADMIN_PASSWORD=""

CMD ["node", "server.js"]
