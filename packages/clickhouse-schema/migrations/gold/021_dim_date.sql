-- Conformed dim_date. No SCD, no dictionary lookup needed — date_key = toYYYYMMDD(date).
-- Pre-populate for a wide static range (e.g. 2015-2035) via a one-time INSERT ... numbers().

CREATE TABLE IF NOT EXISTS gold.dim_date
(
    date_key        UInt32,  -- 20260913
    full_date       Date,
    year            UInt16,
    quarter         UInt8,
    month           UInt8,
    month_name      LowCardinality(String),
    day_of_month    UInt8,
    day_of_week     UInt8,
    is_weekend      UInt8,
    fiscal_period   String   -- adapt to company fiscal calendar if not calendar-year
)
ENGINE = MergeTree
ORDER BY (date_key);
