/**
 * Enterprise DW Bus Matrix, expressed as code instead of a spreadsheet.
 *
 * clickhouse-schema generates DDL from DIMENSIONS (single definition per dim).
 * Adding a new fact = add one entry here + review which dims it needs.
 * A fact must ONLY reference dimension keys declared in DIMENSIONS below —
 * never invent a parallel "local" dimension in a model file.
 */

export const DIMENSIONS = {
  dim_date: {
    grain: '1 row per calendar day',
    surrogateKey: 'date_key', // int YYYYMMDD, no dictionary needed
    scdType: 'none',
  },
  dim_vendor: {
    grain: '1 row per vendor version',
    surrogateKey: 'vendor_sk',
    businessKey: 'vendor_id',
    scdType: 2,
  },
  dim_item: {
    grain: '1 row per item (material/service) version',
    surrogateKey: 'item_sk',
    businessKey: 'item_id',
    scdType: 2,
  },
  dim_cost_center: {
    grain: '1 row per cost center version',
    surrogateKey: 'cost_center_sk',
    businessKey: 'cost_center_id',
    scdType: 2,
  },
  dim_currency: {
    grain: '1 row per currency code (rarely changes)',
    surrogateKey: 'currency_sk',
    businessKey: 'currency_code',
    scdType: 1, // overwrite, no history needed
  },
  dim_user: {
    grain: '1 row per user version (for approver/requester attribution)',
    surrogateKey: 'user_sk',
    businessKey: 'user_id',
    scdType: 2,
  },
} as const;

export type DimensionName = keyof typeof DIMENSIONS;

export const BUS_MATRIX: Record<string, DimensionName[]> = {
  fact_purchase_requisition: ['dim_date', 'dim_item', 'dim_cost_center', 'dim_user'],
  fact_purchase_order: ['dim_date', 'dim_vendor', 'dim_item', 'dim_cost_center', 'dim_currency', 'dim_user'],
  fact_goods_receipt: ['dim_date', 'dim_vendor', 'dim_item', 'dim_user'],
  fact_payment: ['dim_date', 'dim_vendor', 'dim_currency', 'dim_user'],
  fact_procure_to_pay_accumulating: ['dim_date', 'dim_vendor', 'dim_item', 'dim_cost_center'],
};

/** Sanity check run in CI: every dim referenced in the matrix must be declared above. */
export function assertBusMatrixIsValid(): void {
  for (const [fact, dims] of Object.entries(BUS_MATRIX)) {
    for (const dim of dims) {
      if (!(dim in DIMENSIONS)) {
        throw new Error(`Bus matrix error: ${fact} references undeclared dimension "${dim}"`);
      }
    }
  }
}
