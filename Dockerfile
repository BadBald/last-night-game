# LAST NIGHT — production container (static client + authoritative WebSocket server)
FROM node:22-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# Set this to the public URL the browser should use for the WebSocket server.
# For Cloud Run the server and client share an origin, so it can stay empty.
ARG VITE_WS_URL=""
ENV VITE_WS_URL=$VITE_WS_URL

RUN npm run build && npm run build:server

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./server.js

EXPOSE 8080
CMD ["node", "server.js"]
