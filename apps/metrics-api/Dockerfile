FROM node:20-alpine AS builder
WORKDIR /app

# Copy root workspace files
COPY package.json turbo.json ./
COPY packages/contracts ./packages/contracts
COPY packages/dw-bus-matrix ./packages/dw-bus-matrix
COPY packages/metrics-definitions ./packages/metrics-definitions
COPY apps/metrics-api ./apps/metrics-api

RUN npm install
RUN npm run build --workspace=@repo/metrics-definitions
RUN npm run build --workspace=metrics-api

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app ./
WORKDIR /app/apps/metrics-api

EXPOSE 4000
CMD ["node", "dist/main.js"]
