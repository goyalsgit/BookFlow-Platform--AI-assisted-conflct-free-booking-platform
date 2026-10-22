FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci
COPY server server
COPY client client
COPY scripts scripts
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/server/package.json /app/server/package.json
COPY --from=build /app/client/package.json /app/client/package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/server/dist /app/server/dist
COPY --from=build /app/client/dist /app/client/dist
RUN mkdir -p /app/outbox && chown node:node /app/outbox
USER node
EXPOSE 4170
CMD ["node", "server/dist/index.js"]
