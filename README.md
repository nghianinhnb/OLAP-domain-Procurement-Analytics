# OLAP domain — Procurement Analytics (Event-Driven Architecture)

## Data Flow
```
NestJS api (Postgres) --Debezium CDC--> Kafka
                                          |
                            bronze.*_queue (Kafka Engine)
                                          | MV (immediate trigger)
                                 bronze.* (append-only raw)
                                          | MV chain (immediate trigger)
                                 silver.* (ReplacingMergeTree, current-state)
                                          | MV chain + ClickHouse In-Memory Dictionaries (sub-second)
                      gold.dim_* (SCD2 MV)  +  gold.fact_* (Real-time Event-Driven MV)
                                          |
                                 metrics-api (semantic layer)
                                          |
                                     web (Next.js UI)

* Optional / Audit: Nightly dbt reconciliation for strict point-in-time financial reporting.
```

## Where things live and why

| Path | Role |
|---|---|
| `packages/contracts` | CDC event schema (Zod). Shared by `api` (producer) and `olap-ingest` (consumer) so breaking changes fail typecheck, not runtime. |
| `packages/dw-bus-matrix` | Bus matrix as code — which fact uses which conformed dimension. Source of truth, not a spreadsheet. |
| `packages/clickhouse-schema` | All DDL: bronze/silver/gold, dictionaries, and pure event-driven Materialized View chains. |
| `packages/metrics-definitions` | Metric semantic layer — one definition per metric, shared by `metrics-api` and any FE. |
| `apps/olap-ingest` | Side-car validator/DLQ router. Primary ingestion is ClickHouse's own Kafka Engine (see bronze DDL) — this app only catches contract violations. |
| `apps/olap-transform` | Optional nightly reconciliation dbt models (SCD2 closure audit & point-in-time financial joins). |
| `apps/metrics-api` | The only place that turns a metric name + dimension into SQL against ClickHouse. UI never queries ClickHouse directly. |

## Files included in this sample
- `packages/contracts/src/events/purchase-order.event.ts`, `goods-receipt.event.ts`
- `packages/dw-bus-matrix/src/bus-matrix.ts`
- `packages/clickhouse-schema/migrations/init.sh`
- `packages/clickhouse-schema/migrations/bronze/001_bronze_purchase_order.sql`
- `packages/clickhouse-schema/migrations/silver/010_silver_purchase_order.sql`
- `packages/clickhouse-schema/migrations/gold/020_dim_vendor.sql`, `021_dim_date.sql`, `022_fact_purchase_order.sql`, `023_fact_procure_to_pay_accumulating.sql`
- `apps/olap-ingest/src/consumers/purchase-order.consumer.ts`
- `apps/olap-transform/models/gold/dim_vendor.sql`, `fact_purchase_order.sql` (Nightly reconciliation models)
- `apps/metrics-api/src/modules/spend/spend.controller.ts`, `spend.service.ts`
- `infra/debezium/po-connector.json`
- `docker-compose.yml`
- `turbo.json`

## Running locally

```bash
# 1. Khởi động các hạ tầng cốt lõi (Postgres, Kafka, Debezium Connect, ClickHouse)
docker compose up -d postgres kafka debezium-connect clickhouse

# 2. Đăng ký Debezium CDC Connector sau khi debezium-connect sẵn sàng:
curl -X POST -H 'Content-Type: application/json' \
  --data @infra/debezium/po-connector.json \
  http://localhost:8083/connectors

# ClickHouse tự chạy migrations qua init.sh khi container khởi tạo lần đầu.
# Nếu muốn re-apply thủ công:
docker exec -i clickhouse bash /docker-entrypoint-initdb.d/init.sh

# 3. Khởi động Semantic Layer API và Side-car validator
docker compose up -d olap-ingest metrics-api
```

Kiểm tra dữ liệu chảy vào ClickHouse theo thời gian thực (Kafka -> Bronze -> Silver -> Gold):
```bash
# Kiểm tra Bronze raw landing
docker exec -it clickhouse clickhouse-client -q "SELECT count() FROM bronze.purchase_order"

# Kiểm tra Silver current-state
docker exec -it clickhouse clickhouse-client -q "SELECT count() FROM silver.purchase_order"

# Kiểm tra Gold real-time fact
docker exec -it clickhouse clickhouse-client -q "SELECT count() FROM gold.fact_purchase_order"
```

## Chạy Nightly Reconciliation (Optional / Manual)
```bash
# Khi cần chạy dbt rà soát lại point-in-time SCD2 cho báo cáo tài chính tháng:
docker compose run --rm olap-transform dbt run --target prod
```

