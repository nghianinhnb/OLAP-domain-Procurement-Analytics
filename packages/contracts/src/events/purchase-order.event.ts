import { z } from 'zod';

/**
 * Shape after Debezium/outbox flattening (before/after already resolved).
 * BE (api app) imports this to type the outbox payload it writes.
 * olap-ingest imports the SAME schema to validate/parse incoming Kafka messages.
 * Any breaking change here fails typecheck on both sides at build time.
 */
export const PurchaseOrderCdcEventSchema = z.object({
  op: z.enum(['c', 'u', 'd']), // create / update / delete (Debezium op codes)
  ts_ms: z.number(), // event timestamp, used as version for ReplacingMergeTree
  lsn: z.string(), // source WAL/binlog position, used for ordering + idempotency
  source_table: z.literal('purchase_order'),
  after: z
    .object({
      po_id: z.string().uuid(),
      po_number: z.string(),
      pr_id: z.string().uuid().nullable(), // links back to originating PR
      vendor_id: z.string().uuid(),
      cost_center_id: z.string().uuid(),
      currency_code: z.string().length(3),
      status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'CLOSED', 'CANCELLED']),
      total_amount: z.number(),
      created_by: z.string().uuid(),
      created_at: z.string().datetime(),
      approved_at: z.string().datetime().nullable(),
    })
    .nullable(), // null when op === 'd'
  lines: z
    .array(
      z.object({
        po_line_id: z.string().uuid(),
        item_id: z.string().uuid(),
        quantity: z.number(),
        unit_price: z.number(),
        line_amount: z.number(),
      }),
    )
    .optional(),
});

export type PurchaseOrderCdcEvent = z.infer<typeof PurchaseOrderCdcEventSchema>;

export const PURCHASE_ORDER_TOPIC = 'erp.cdc.purchase_order' as const;
