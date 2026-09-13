-- gold.dim_vendor — Nightly SCD2 Reconciliation / Audit Model.
--
-- NOTE: In the pure event-driven architecture, real-time ingestion is handled
-- automatically by the Materialized View `gold.mv_dim_vendor_scd` and `gold.dict_vendor_current`.
-- This dbt model runs as a nightly reconciliation job to close historical records
-- (setting valid_to = now, is_current = 0) and audit consistency.
--
-- Source: silver.vendor (current-state table populated via CDC MV).


with current_gold as (
    select * from {{ this }}
    where is_current = 1
),

latest_silver as (
    select
        vendor_id,
        argMax(vendor_name, version)   as vendor_name,
        argMax(vendor_tier, version)   as vendor_tier,
        argMax(country_code, version)  as country_code,
        max(version)                    as version
    from {{ source('silver', 'vendor') }}
    group by vendor_id
    having argMax(is_deleted, version) = 0
),

changed as (
    select l.*
    from latest_silver l
    left join current_gold c using (vendor_id)
    where c.vendor_id is null                         -- brand new vendor
       or c.vendor_name  != l.vendor_name
       or c.vendor_tier  != l.vendor_tier
       or c.country_code != l.country_code             -- tracked attributes only
)

select
    cityHash64(vendor_id, now64(3)) as vendor_sk,
    vendor_id,
    vendor_name,
    vendor_tier,
    country_code,
    now64(3)                        as valid_from,
    toDateTime64('9999-12-31', 3)   as valid_to,
    1                                as is_current,
    version
from changed

-- Orchestration also issues, in the same run:
--   ALTER TABLE gold.dim_vendor UPDATE valid_to = now64(3), is_current = 0
--   WHERE vendor_id IN (select vendor_id from changed) AND is_current = 1 AND valid_from < now64(3)
-- (ClickHouse mutations are async — acceptable here since dim closes happen in batch, not real-time)
