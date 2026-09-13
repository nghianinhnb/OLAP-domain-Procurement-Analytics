FROM node:20-alpine AS builder
WORKDIR /app

# Copy root workspace files
COPY package.json turbo.json ./
COPY packages/contracts ./packages/contracts
COPY packages/dw-bus-matrix ./packages/dw-bus-matrix
COPY packages/metrics-definitions ./packages/metrics-definitions
COPY apps/olap-ingest ./apps/olap-ingest

RUN npm install
RUN npm run build --workspace=@repo/contracts
RUN npm run build --workspace=olap-ingest

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app ./
WORKDIR /app/apps/olap-ingest

CMD ["node", "dist/main.js"]
