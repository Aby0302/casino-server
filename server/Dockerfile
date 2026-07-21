FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js ./
COPY games/ ./games/
COPY models/ ./models/
COPY maps/ ./maps/

# Link game sources
RUN ln -s /app/../slot /app/slot && ln -s /app/../sugar-rush-clone/frontend/dist /app/sugar-rush

EXPOSE 3001
CMD ["node", "index.js"]
