FROM node:22.23.3-trixie-slim
WORKDIR /app
COPY --chown=node:node core.mjs runner.mjs ./
USER node
ENV NODE_ENV=production TZ=UTC
CMD ["node", "runner.mjs"]
