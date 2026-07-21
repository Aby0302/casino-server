FROM node:20-alpine

WORKDIR /app

# Copy and build sugar-rush frontend
COPY sugar-rush-clone/frontend/package*.json ./sugar-rush-clone/frontend/
RUN cd sugar-rush-clone/frontend && npm ci && cd ../..
COPY sugar-rush-clone/frontend/ ./sugar-rush-clone/frontend/
RUN cd sugar-rush-clone/frontend && npm run build

# Copy slot game
COPY slot/ ./slot/

# Set up server
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/ ./server/

# Create symlinks for static serving
RUN ln -s /app/slot /app/server/slot && \
    ln -s /app/sugar-rush-clone/frontend/dist /app/server/sugar-rush

EXPOSE 3001
WORKDIR /app/server
CMD ["node", "index.js"]
