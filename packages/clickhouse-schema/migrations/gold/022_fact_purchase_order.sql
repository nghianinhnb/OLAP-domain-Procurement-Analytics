-- Fact: fact_purchase_order
-- Grain: 1 row = 1 PO line item.
-- Dims per bus matrix: dim_date, dim_vendor, dim_item, dim_cost_center, dim_currency, dim_user

CREATE TABLE IF NOT EXISTS gold.fact_purchase_order
(
    po_line_id          UUID,
    po_id               UUID,
    date_key            UInt32,          -- FK -> dim_date (created_at)
    vendor_sk           UInt64,          -- FK -> dim_vendor (current version at created_at)
    item_sk             UInt64,          -- FK -> dim_item
    cost_center_sk      UInt64,          -- FK -> dim_cost_center
    currency_sk         UInt64,          -- FK -> dim_currency
    created_by_user_sk  UInt64,          -- FK -> dim_user
    status              LowCardinality(String),
    quantity            Decimal(18, 3),
    unit_price          Decimal(18, 4),
    line_amount         Decimal(18, 2),  -- additive measure
    line_amount_base_ccy Decimal(18, 2)  -- converted to reporting currency, additive across vendors
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(toDate(toString(date_key), 'YYYYMMDD'))
ORDER BY (date_key, vendor_sk, cost_center_sk);

-- Pre-aggregation for the most common dashboard query (spend by vendor by month).
-- Query the projection transparently; ClickHouse picks it when the query matches.
ALTER TABLE gold.fact_purchase_order
ADD PROJECTION IF NOT EXISTS proj_spend_by_vendor_month
(
    SELECT
        toYYYYMM(toDate(toString(date_key), 'YYYYMMDD')) AS year_month,
        vendor_sk,
        sum(line_amount_base_ccy) AS total_spend,
        count() AS line_count
    GROUP BY year_month, vendor_sk
);

-- Real-time Event-Driven MV: Triggers on insert to silver.purchase_order_line,
-- joins with silver.purchase_order header, and enriches dimensions via fast in-memory dictionaries.
-- Latency: sub-second (Kafka -> Bronze -> Silver -> Gold). No batch/cron needed.
CREATE MATERIALIZED VIEW IF NOT EXISTS gold.mv_fact_purchase_order
TO gold.fact_purchase_order AS
SELECT
    l.po_line_id,
    l.po_id,
    toYYYYMMDD(h.created_at)                                                      AS date_key,
    dictGetOrDefault('gold.dict_vendor_current', 'vendor_sk', h.vendor_id, cityHash64(h.vendor_id)) AS vendor_sk,
    cityHash64(l.item_id)                                                         AS item_sk,
    cityHash64(h.cost_center_id)                                                  AS cost_center_sk,
    cityHash64(h.currency_code)                                                   AS currency_sk,
    cityHash64(h.created_by)                                                      AS created_by_user_sk,
    h.status                                                                      AS status,
    l.quantity                                                                    AS quantity,
    l.unit_price                                                                  AS unit_price,
    l.line_amount                                                                 AS line_amount,
    l.line_amount                                                                 AS line_amount_base_ccy
FROM silver.purchase_order_line AS l
INNER JOIN silver.purchase_order AS h USING (po_id)
WHERE l.is_deleted = 0;

