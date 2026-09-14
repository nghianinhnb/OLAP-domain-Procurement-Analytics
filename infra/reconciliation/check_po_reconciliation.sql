-- Run against Postgres (source) and ClickHouse (silver) separately, then diff
-- the two result sets in the runner script. Never expect a 100% real-time match —
-- some lag is normal. Alert on drift that persists past the lag SLA, not on any single mismatch.

-- 1) Row count + checksum from the SOURCE (Postgres)
SELECT
    count(*) AS row_count,
    sum(('x' || substr(md5(po_id::text || status || total_amount::text), 1, 16))::bit(64)::bigint) AS checksum
FROM purchase_order
WHERE deleted_at IS NULL;

-- 2) Same shape from ClickHouse silver (current-state, excluding soft-deletes)
SELECT
    count() AS row_count,
    sum(reinterpretAsInt64(reverse(substring(MD5(concat(toString(po_id), status, toString(total_amount))), 1, 8)))) AS checksum
FROM (
    SELECT po_id,
           argMax(status, version) AS status,
           argMax(total_amount, version) AS total_amount
    FROM silver.purchase_order
    GROUP BY po_id
    HAVING argMax(is_deleted, version) = 0
);

-- If row_count matches but checksum doesn't: a field is being transformed/dropped
--   incorrectly somewhere in the bronze->silver mapping (e.g. currency rounding).
-- If row_count doesn't match: rows are being lost or duplicated upstream —
--   check DLQ volume in olap-ingest and Debezium connector lag first.
