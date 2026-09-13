-- Conformed dimension: dim_vendor (SCD Type 2) + Real-time Dictionary
-- Referenced by fact_purchase_order, fact_goods_receipt, fact_payment (see bus-matrix.ts)

-- 1. Gold SCD Type 2 Dimension Table
CREATE TABLE IF NOT EXISTS gold.dim_vendor
(
    vendor_sk       UInt64,      -- surrogate key, cityHash64(vendor_id, valid_from)
    vendor_id       UUID,        -- business key
    vendor_name     String,
    vendor_tier     LowCardinality(String),
    country_code    FixedString(2),
    valid_from      DateTime64(3),
    valid_to        DateTime64(3),
    is_current      UInt8,
    version         UInt64
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (vendor_id, valid_from);

-- 2. Event-driven MV for SCD2 Dimension (inserts new version candidates immediately on silver.vendor change)
CREATE MATERIALIZED VIEW IF NOT EXISTS gold.mv_dim_vendor_scd
TO gold.dim_vendor AS
SELECT
    cityHash64(vendor_id, toUnixTimestamp64Milli(now64(3))) AS vendor_sk,
    vendor_id,
    vendor_name,
    vendor_tier,
    country_code,
    now64(3) AS valid_from,
    toDateTime64('9999-12-31 23:59:59.999', 3) AS valid_to,
    1 AS is_current,
    version
FROM silver.vendor
WHERE is_deleted = 0;

-- 3. Real-time In-Memory ClickHouse Dictionary for zero-lag fact enrichment
-- Refreshes every 5-10s from silver.vendor, enabling instant dictGetUInt64() lookups inside streaming fact MVs.
CREATE DICTIONARY IF NOT EXISTS gold.dict_vendor_current
(
    vendor_id       UUID,
    vendor_sk       UInt64,
    vendor_name     String,
    vendor_tier     String,
    country_code    String
)
PRIMARY KEY vendor_id
SOURCE(CLICKHOUSE(TABLE 'vendor' DB 'silver'))
LIFETIME(MIN 5 MAX 10)
LAYOUT(HASHED());

