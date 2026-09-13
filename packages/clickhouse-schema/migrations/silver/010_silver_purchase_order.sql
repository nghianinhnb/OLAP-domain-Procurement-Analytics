-- Silver: one row per po_id representing current state.
-- version = ts_ms -> ReplacingMergeTree keeps the latest event per PK on merge.
-- is_deleted handles CDC deletes (ClickHouse has no efficient hard delete for streaming).

CREATE TABLE IF NOT EXISTS silver.purchase_order
(
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
    version         UInt64, -- = ts_ms from bronze
    is_deleted      UInt8 DEFAULT 0
)
ENGINE = ReplacingMergeTree(version, is_deleted)
ORDER BY (po_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS silver.mv_purchase_order
TO silver.purchase_order AS
SELECT
    po_id, po_number, pr_id, vendor_id, cost_center_id, currency_code,
    status, toDecimal64(total_amount, 2) AS total_amount, created_by,
    created_at, approved_at,
    ts_ms AS version,
    if(op = 'd', 1, 0) AS is_deleted
FROM bronze.purchase_order;

-- Line items exploded to their own current-state table (grain = po_line)
CREATE TABLE IF NOT EXISTS silver.purchase_order_line
(
    po_line_id      UUID,
    po_id           UUID,
    item_id         UUID,
    quantity        Decimal(18, 3),
    unit_price      Decimal(18, 4),
    line_amount     Decimal(18, 2),
    version         UInt64,
    is_deleted      UInt8 DEFAULT 0
)
ENGINE = ReplacingMergeTree(version, is_deleted)
ORDER BY (po_line_id);

-- Event-driven MV exploding lines directly from bronze.purchase_order stream
CREATE MATERIALIZED VIEW IF NOT EXISTS silver.mv_purchase_order_line
TO silver.purchase_order_line AS
SELECT
    toUUID(JSONExtractString(line, 'po_line_id'))          AS po_line_id,
    po_id,
    toUUID(JSONExtractString(line, 'item_id'))             AS item_id,
    toDecimal64(JSONExtractString(line, 'quantity'), 3)    AS quantity,
    toDecimal64(JSONExtractString(line, 'unit_price'), 4)   AS unit_price,
    toDecimal64(JSONExtractString(line, 'line_amount'), 2)  AS line_amount,
    ts_ms                                                  AS version,
    if(op = 'd', 1, 0)                                     AS is_deleted
FROM (
    SELECT po_id, op, ts_ms, arrayJoin(JSONExtractArrayRaw(lines)) AS line
    FROM bronze.purchase_order
    WHERE length(lines) > 0
);

-- Silver vendor table (source for real-time dimension dictionary & SCD2 MV)
CREATE TABLE IF NOT EXISTS silver.vendor
(
    vendor_id       UUID,
    vendor_name     String,
    vendor_tier     LowCardinality(String),
    country_code    FixedString(2),
    version         UInt64,
    is_deleted      UInt8 DEFAULT 0
)
ENGINE = ReplacingMergeTree(version, is_deleted)
ORDER BY (vendor_id);

