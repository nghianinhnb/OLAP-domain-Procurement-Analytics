-- Singular dbt test: sum of PO line amounts in gold must equal the PO header
-- total in silver. A generic not_null/unique test would never catch a join
-- fan-out bug (e.g. duplicate lines from a bad join key) — this business
-- invariant does. dbt fails the test if this query returns ANY row.

with header as (
    select
        po_id,
        argMax(total_amount, version) as header_total
    from {{ source('silver', 'purchase_order') }}
    group by po_id
    having argMax(is_deleted, version) = 0
),

fact_rollup as (
    select po_id, sum(line_amount) as fact_total
    from {{ ref('fact_purchase_order') }}
    group by po_id
)

select h.po_id, h.header_total, f.fact_total
from header h
join fact_rollup f using (po_id)
where abs(h.header_total - f.fact_total) > 0.01
