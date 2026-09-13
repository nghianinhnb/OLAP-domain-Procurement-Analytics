-- Bronze: raw CDC landing for purchase_order. Append-only, never mutated.
-- Never SELECT directly from the *_queue table — it's a consumer, not storage.

CREATE TABLE IF NOT EXISTS bronze.purchase_order_queue
(
    raw String
)
ENGINE = Kafka
SETTINGS
    kafka_broker_list = 'kafka:9092',
    kafka_topic_list = 'erp.cdc.purchase_order',
    kafka_group_name = 'clickhouse_bronze_po',
    kafka_format = 'JSONAsString',
    kafka_num_consumers = 2;

CREATE TABLE IF NOT EXISTS bronze.purchase_order
(
    op              LowCardinality(String),
    ts_ms           UInt64,
    lsn             String,
    po_id           UUID,
    po_number       String,
    pr_id           Nullable(UUID),
    vendor_id       UUID,
    cost_center_id  UUID,
    currency_code   FixedString(3),
    status          LowCardinality(String),
    total_amount    Decimal(18, 2),
    created_by      UUID,
    created_at      DateTime64(3),
    approved_at     Nullable(DateTime64(3)),
    lines           String, -- raw JSON array of line items, exploded in silver
    _ingested_at    DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (po_id, ts_ms);

CREATE MATERIALIZED VIEW IF NOT EXISTS bronze.mv_purchase_order
TO bronze.purchase_order AS
SELECT
    JSONExtractString(raw, 'op')                                   AS op,
    JSONExtractUInt(raw, 'ts_ms')                                   AS ts_ms,
    JSONExtractString(raw, 'lsn')                                   AS lsn,
    toUUID(JSONExtractString(raw, 'after.po_id'))                   AS po_id,
    JSONExtractString(raw, 'after.po_number')                       AS po_number,
    toUUIDOrNull(JSONExtractString(raw, 'after.pr_id'))             AS pr_id,
    toUUID(JSONExtractString(raw, 'after.vendor_id'))               AS vendor_id,
    toUUID(JSONExtractString(raw, 'after.cost_center_id'))          AS cost_center_id,
    JSONExtractString(raw, 'after.currency_code')                   AS currency_code,
    JSONExtractString(raw, 'after.status')                          AS status,
    JSONExtractString(raw, 'after.total_amount')                    AS total_amount,
    toUUID(JSONExtractString(raw, 'after.created_by'))              AS created_by,
    parseDateTime64BestEffort(JSONExtractString(raw, 'after.created_at'))  AS created_at,
    parseDateTime64BestEffortOrNull(JSONExtractString(raw, 'after.approved_at')) AS approved_at,
    JSONExtractRaw(raw, 'lines')                                    AS lines
FROM bronze.purchase_order_queue;
