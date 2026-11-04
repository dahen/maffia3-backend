FROM node:24-bookworm-slim AS build
WORKDIR /srv
COPY maffia3-backend/package*.json ./maffia3-backend/
COPY maffia3-frontend/package*.json ./maffia3-frontend/
RUN cd maffia3-backend && npm ci
RUN cd maffia3-frontend && npm ci
COPY maffia3-backend ./maffia3-backend
COPY maffia3-frontend ./maffia3-frontend
RUN cd maffia3-backend && npm run check
RUN cd maffia3-frontend && npm run build

FROM node:24-bookworm-slim
ARG VERSION
ARG BACKEND_SHA
ARG FRONTEND_SHA
LABEL org.opencontainers.image.source="https://github.com/dahen/maffia3-backend" \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.revision=$BACKEND_SHA \
      se.steensland.maffia.version=$VERSION \
      se.steensland.maffia.backend=$BACKEND_SHA \
      se.steensland.maffia.frontend=$FRONTEND_SHA
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3047 MAFFIA_DB_PATH=/data/maffia3.sqlite \
    MAFFIA_VERSION=$VERSION MAFFIA_BACKEND_SHA=$BACKEND_SHA MAFFIA_FRONTEND_SHA=$FRONTEND_SHA
WORKDIR /srv/maffia3-backend
COPY maffia3-backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir -p /data && chown node:node /data
COPY maffia3-backend/src ./src
COPY --from=build /srv/maffia3-frontend/dist /srv/maffia3-frontend/dist
USER node
EXPOSE 3047
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3047/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/server.ts"]
