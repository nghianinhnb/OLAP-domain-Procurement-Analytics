import { z } from 'zod';

export const GoodsReceiptCdcEventSchema = z.object({
  op: z.enum(['c', 'u', 'd']),
  ts_ms: z.number(),
  lsn: z.string(),
  source_table: z.literal('goods_receipt'),
  after: z
    .object({
      gr_id: z.string().uuid(),
      gr_number: z.string(),
      po_id: z.string().uuid(),
      received_by: z.string().uuid(),
      received_at: z.string().datetime(),
      status: z.enum(['PENDING', 'PARTIAL', 'COMPLETE', 'REJECTED']),
    })
    .nullable(),
  lines: z
    .array(
      z.object({
        gr_line_id: z.string().uuid(),
        po_line_id: z.string().uuid(),
        item_id: z.string().uuid(),
        quantity_received: z.number(),
      }),
    )
    .optional(),
});

export type GoodsReceiptCdcEvent = z.infer<typeof GoodsReceiptCdcEventSchema>;

export const GOODS_RECEIPT_TOPIC = 'erp.cdc.goods_receipt' as const;
