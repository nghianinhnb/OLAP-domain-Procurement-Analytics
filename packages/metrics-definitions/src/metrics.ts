/**
 * Metric definitions — the semantic layer. UI never writes its own aggregation SQL;
 * it asks metrics-api for a named metric with dimensions/filters, and the SQL
 * generation logic (in metrics-api) reads these definitions.
 * Adding/renaming a metric happens here once, not in N different dashboard queries.
 */

export const METRICS = {
  total_spend: {
    label: 'Total PO Spend',
    table: 'gold.fact_purchase_order',
    measure: 'sum(line_amount_base_ccy)',
    allowedDimensions: ['vendor_sk', 'cost_center_sk', 'date_key'],
    defaultFilter: "status != 'CANCELLED'",
  },
  po_line_count: {
    label: 'PO Line Count',
    table: 'gold.fact_purchase_order',
    measure: 'count()',
    allowedDimensions: ['vendor_sk', 'cost_center_sk', 'date_key'],
    defaultFilter: "status != 'CANCELLED'",
  },
  avg_procure_to_pay_days: {
    label: 'Avg Procure-to-Pay Cycle Time (days)',
    table: 'gold.fact_procure_to_pay_accumulating',
    measure: 'avg(pr_to_payment_days)',
    allowedDimensions: ['vendor_sk', 'cost_center_sk'],
    defaultFilter: "current_stage = 'PAID'",
  },
} as const;

export type MetricName = keyof typeof METRICS;
