-- gold.fact_purchase_order — Nightly Point-in-Time SCD2 Reconciliation Model.
--
-- NOTE: In the pure event-driven architecture, fact rows are populated immediately
-- via `gold.mv_fact_purchase_order` using dictionary lookups (< 1s latency).
-- This dbt model is used for nightly reconciliation / financial reporting:
-- it performs strict point-in-time SCD2 joins (valid_from <= created_at < valid_to)
-- across all historical dimension tables to ensure 100% financial correctness.


with po_current as (
    select
        po_id,
        argMax(po_number, version)      as po_number,
        argMax(vendor_id, version)      as vendor_id,
        argMax(cost_center_id, version) as cost_center_id,
        argMax(currency_code, version)  as currency_code,
        argMax(status, version)         as status,
        argMax(created_at, version)     as created_at,
        argMax(created_by, version)     as created_by
    from {{ source('silver', 'purchase_order') }}
    group by po_id
    having argMax(is_deleted, version) = 0
),

po_line_current as (
    select
        po_line_id, po_id, item_id,
        argMax(quantity, version)    as quantity,
        argMax(unit_price, version)  as unit_price,
        argMax(line_amount, version) as line_amount
    from {{ source('silver', 'purchase_order_line') }}
    group by po_line_id, po_id, item_id
    having argMax(is_deleted, version) = 0
)

select
    l.po_line_id,
    l.po_id,
    toYYYYMMDD(h.created_at)                              as date_key,
    v.vendor_sk,        -- point-in-time SCD2 join: v.valid_from <= created_at < v.valid_to
    i.item_sk,
    cc.cost_center_sk,
    cur.currency_sk,
    u.user_sk                                             as created_by_user_sk,
    h.status,
    l.quantity,
    l.unit_price,
    l.line_amount,
    l.line_amount * fx.rate_to_base                       as line_amount_base_ccy
from po_line_current l
inner join po_current h using (po_id)
inner join {{ ref('dim_vendor') }} v
    on v.vendor_id = h.vendor_id
    and h.created_at >= v.valid_from and h.created_at < v.valid_to
inner join {{ ref('dim_item') }} i
    on i.item_id = l.item_id
    and h.created_at >= i.valid_from and h.created_at < i.valid_to
inner join {{ ref('dim_cost_center') }} cc
    on cc.cost_center_id = h.cost_center_id
    and h.created_at >= cc.valid_from and h.created_at < cc.valid_to
inner join {{ ref('dim_currency') }} cur on cur.currency_code = h.currency_code
inner join {{ ref('dim_user') }} u
    on u.user_id = h.created_by
    and h.created_at >= u.valid_from and h.created_at < u.valid_to
left join {{ ref('fx_rates') }} fx
    on fx.currency_code = h.currency_code and fx.rate_date = toDate(h.created_at)
