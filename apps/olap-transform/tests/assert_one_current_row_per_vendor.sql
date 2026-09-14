-- SCD2 invariant that accepted_values on is_current alone can't express:
-- exactly ONE is_current=1 row per business key, never zero, never two.
-- Two current rows usually means the MV/merge logic raced or double-fired.

select vendor_id, count(*) as current_row_count
from {{ ref('dim_vendor') }}
where is_current = 1
group by vendor_id
having count(*) != 1
