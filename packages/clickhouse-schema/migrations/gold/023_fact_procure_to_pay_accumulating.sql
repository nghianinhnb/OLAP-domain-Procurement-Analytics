-- Accumulating snapshot fact: tracks one PR line through its entire lifecycle.
-- Grain: 1 row = 1 PR line. Row is UPDATED (re-inserted with ReplacingMergeTree)
-- each time the line progresses to the next milestone — classic Kimball pattern
-- for measuring cycle time / lead time across a multi-step business process.

CREATE TABLE IF NOT EXISTS gold.fact_procure_to_pay_accumulating
(
    pr_line_id          UUID,
    vendor_sk           UInt64,
    item_sk             UInt64,
    cost_center_sk      UInt64,

    -- milestone dates (nullable until reached)
    pr_created_date_key     Nullable(UInt32),
    po_created_date_key     Nullable(UInt32),
    gr_received_date_key    Nullable(UInt32),
    payment_posted_date_key Nullable(UInt32),

    -- derived durations in days, computed at load time in olap-transform
    pr_to_po_days       Nullable(UInt16),
    po_to_gr_days       Nullable(UInt16),
    gr_to_payment_days  Nullable(UInt16),
    pr_to_payment_days  Nullable(UInt16), -- total cycle time, the headline metric

    current_stage       LowCardinality(String), -- PR_ONLY / PO_ISSUED / RECEIVED / PAID
    version             UInt64
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (pr_line_id);

-- Typical UI metric: avg(pr_to_payment_days) GROUP BY vendor_sk, month
-- This table is what makes that a single GROUP BY instead of a 4-way join at query time.

-- =============================================================================
-- Event-driven MV Chain for Accumulating Snapshot Milestones:
-- Each stage (PR -> PO -> GR -> Payment) pushes its milestone timestamp immediately.
-- ReplacingMergeTree(version) reconciles the latest lifecycle state per pr_line_id.
-- =============================================================================

-- Milestone 1: Requisition Created
-- (Assuming silver.purchase_requisition_line stream)
-- CREATE MATERIALIZED VIEW IF NOT EXISTS gold.mv_fact_p2p_from_pr
-- TO gold.fact_procure_to_pay_accumulating AS
-- SELECT
--     pr_line_id,
--     dictGetOrDefault('gold.dict_vendor_current', 'vendor_sk', vendor_id, cityHash64(vendor_id)) AS vendor_sk,
--     cityHash64(item_id)                                AS item_sk,
--     cityHash64(cost_center_id)                         AS cost_center_sk,
--     toYYYYMMDD(created_at)                             AS pr_created_date_key,
--     CAST(NULL, 'Nullable(UInt32)')                     AS po_created_date_key,
--     CAST(NULL, 'Nullable(UInt32)')                     AS gr_received_date_key,
--     CAST(NULL, 'Nullable(UInt32)')                     AS payment_posted_date_key,
--     CAST(NULL, 'Nullable(UInt16)')                     AS pr_to_po_days,
--     CAST(NULL, 'Nullable(UInt16)')                     AS po_to_gr_days,
--     CAST(NULL, 'Nullable(UInt16)')                     AS gr_to_payment_days,
--     CAST(NULL, 'Nullable(UInt16)')                     AS pr_to_payment_days,
--     'PR_ONLY'                                          AS current_stage,
--     version
-- FROM silver.purchase_requisition_line
-- WHERE is_deleted = 0;

-- Milestone 2: Purchase Order Issued
CREATE MATERIALIZED VIEW IF NOT EXISTS gold.mv_fact_p2p_from_po
TO gold.fact_procure_to_pay_accumulating AS
SELECT
    assumeNotNull(pr_id)                               AS pr_line_id, -- mapped PR reference
    dictGetOrDefault('gold.dict_vendor_current', 'vendor_sk', vendor_id, cityHash64(vendor_id)) AS vendor_sk,
    CAST(0, 'UInt64')                                  AS item_sk,
    cityHash64(cost_center_id)                         AS cost_center_sk,
    CAST(NULL, 'Nullable(UInt32)')                     AS pr_created_date_key,
    toYYYYMMDD(created_at)                             AS po_created_date_key,
    CAST(NULL, 'Nullable(UInt32)')                     AS gr_received_date_key,
    CAST(NULL, 'Nullable(UInt32)')                     AS payment_posted_date_key,
    CAST(NULL, 'Nullable(UInt16)')                     AS pr_to_po_days,
    CAST(NULL, 'Nullable(UInt16)')                     AS po_to_gr_days,
    CAST(NULL, 'Nullable(UInt16)')                     AS gr_to_payment_days,
    CAST(NULL, 'Nullable(UInt16)')                     AS pr_to_payment_days,
    'PO_ISSUED'                                        AS current_stage,
    version
FROM silver.purchase_order
WHERE pr_id IS NOT NULL AND is_deleted = 0;

-- Milestone 3: Goods Received
-- (Assuming silver.goods_receipt stream)
-- CREATE MATERIALIZED VIEW IF NOT EXISTS gold.mv_fact_p2p_from_gr
-- TO gold.fact_procure_to_pay_accumulating AS
-- SELECT
--     pr_line_id,
--     dictGetOrDefault('gold.dict_vendor_current', 'vendor_sk', vendor_id, cityHash64(vendor_id)) AS vendor_sk,
--     cityHash64(item_id)                                AS item_sk,
--     cityHash64(cost_center_id)                         AS cost_center_sk,
--     CAST(NULL, 'Nullable(UInt32)')                     AS pr_created_date_key,
--     CAST(NULL, 'Nullable(UInt32)')                     AS po_created_date_key,
--     toYYYYMMDD(received_at)                            AS gr_received_date_key,
--     CAST(NULL, 'Nullable(UInt32)')                     AS payment_posted_date_key,
--     CAST(NULL, 'Nullable(UInt16)')                     AS pr_to_po_days,
--     CAST(NULL, 'Nullable(UInt16)')                     AS po_to_gr_days,
--     CAST(NULL, 'Nullable(UInt16)')                     AS gr_to_payment_days,
--     CAST(NULL, 'Nullable(UInt16)')                     AS pr_to_payment_days,
--     'RECEIVED'                                         AS current_stage,
--     version
-- FROM silver.goods_receipt
-- WHERE is_deleted = 0;

-- Milestone 4: Payment Posted
-- (Assuming silver.payment stream)
-- CREATE MATERIALIZED VIEW IF NOT EXISTS gold.mv_fact_p2p_from_payment
-- TO gold.fact_procure_to_pay_accumulating AS
-- SELECT
--     pr_line_id,
--     dictGetOrDefault('gold.dict_vendor_current', 'vendor_sk', vendor_id, cityHash64(vendor_id)) AS vendor_sk,
--     CAST(0, 'UInt64')                                  AS item_sk,
--     CAST(0, 'UInt64')                                  AS cost_center_sk,
--     CAST(NULL, 'Nullable(UInt32)')                     AS pr_created_date_key,
--     CAST(NULL, 'Nullable(UInt32)')                     AS po_created_date_key,
--     CAST(NULL, 'Nullable(UInt32)')                     AS gr_received_date_key,
--     toYYYYMMDD(posted_at)                              AS payment_posted_date_key,
--     CAST(NULL, 'Nullable(UInt16)')                     AS pr_to_po_days,
--     CAST(NULL, 'Nullable(UInt16)')                     AS po_to_gr_days,
--     CAST(NULL, 'Nullable(UInt16)')                     AS gr_to_payment_days,
--     CAST(NULL, 'Nullable(UInt16)')                     AS pr_to_payment_days,
--     'PAID'                                             AS current_stage,
--     version
-- FROM silver.payment
-- WHERE is_deleted = 0;

