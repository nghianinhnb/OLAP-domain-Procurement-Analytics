import { PurchaseOrderCdcEventSchema } from '../purchase-order.event';
import poCreated from './__fixtures__/po-created.json';
import poDeleted from './__fixtures__/po-deleted.json';

describe('PurchaseOrderCdcEventSchema (contract test)', () => {
  // Fixtures are captured from real Debezium output, not hand-written —
  // hand-written JSON tends to "agree with itself" and misses real quirks
  // (e.g. Debezium serializing decimals as strings, nulls on delete).
  it('accepts a real "create" payload from Debezium', () => {
    const result = PurchaseOrderCdcEventSchema.safeParse(poCreated);
    expect(result.success).toBe(true);
  });

  it('accepts a real "delete" payload (after = null)', () => {
    const result = PurchaseOrderCdcEventSchema.safeParse(poDeleted);
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing the required op field', () => {
    const { op, ...withoutOp } = poCreated as any;
    const result = PurchaseOrderCdcEventSchema.safeParse(withoutOp);
    expect(result.success).toBe(false);
  });

  it('rejects an unknown status value (catches enum drift from BE)', () => {
    const bad = { ...poCreated, after: { ...poCreated.after, status: 'SOMETHING_NEW' } };
    const result = PurchaseOrderCdcEventSchema.safeParse(bad);
    expect(result.success).toBe(false);
    // If this test starts failing after a legitimate BE change (new status added),
    // that's the signal to update the schema here FIRST, in the same PR as the BE change —
    // not to loosen the schema to make the test pass.
  });

  it('rejects wrong source_table (guards against topic misrouting)', () => {
    const bad = { ...poCreated, source_table: 'goods_receipt' };
    expect(PurchaseOrderCdcEventSchema.safeParse(bad).success).toBe(false);
  });
});
