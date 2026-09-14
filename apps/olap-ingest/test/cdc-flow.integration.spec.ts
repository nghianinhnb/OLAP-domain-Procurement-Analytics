import { startTestStack, stopTestStack, waitForCondition, TestStack } from './test-stack';
import { produceRaw } from './helpers/produce-raw';

describe('CDC flow: bronze -> silver current-state (integration)', () => {
  let stack: TestStack;
  const poId = 'b3f1c2a0-1111-4a2b-9c3d-000000000001';

  beforeAll(async () => {
    stack = await startTestStack();
  }, 60_000);

  afterAll(async () => stopTestStack(stack));

  it('resolves to the latest status when events arrive out of order', async () => {
    // Kafka gives no cross-partition ordering guarantee — CDC events for the
    // same po_id CAN arrive out of order if produced from different partitions
    // or after a consumer rebalance. version = ts_ms must win regardless of arrival order.
    const v1 = { ts_ms: 1000, status: 'DRAFT' };
    const v3 = { ts_ms: 3000, status: 'APPROVED' };
    const v2 = { ts_ms: 2000, status: 'SUBMITTED' };

    await produceRaw(stack, 'erp.cdc.purchase_order', poId, [v3, v1, v2]); // sent out of order on purpose

    await waitForCondition(async () => {
      const rows = await stack.ch.query({
        query: `SELECT count() as c FROM bronze.purchase_order WHERE po_id = {id:String}`,
        query_params: { id: poId },
        format: 'JSONEachRow',
      });
      return (await rows.json<{ c: string }[]>())[0].c === '3';
    });

    const result = await stack.ch.query({
      query: `
        SELECT argMax(status, version) as status
        FROM silver.purchase_order WHERE po_id = {id:String} GROUP BY po_id`,
      query_params: { id: poId },
      format: 'JSONEachRow',
    });
    const [{ status }] = await result.json<{ status: string }[]>();

    expect(status).toBe('APPROVED'); // must reflect ts_ms=3000, despite arriving first
  });

  it('does not double-count when the same event is delivered twice (at-least-once)', async () => {
    const event = { ts_ms: 4000, status: 'APPROVED', total_amount: 100 };
    await produceRaw(stack, 'erp.cdc.purchase_order', poId, [event, event]); // duplicate on purpose

    await waitForCondition(async () => {
      const r = await stack.ch.query({
        query: `SELECT count() as c FROM bronze.purchase_order WHERE po_id = {id:String} AND version = 4000`,
        query_params: { id: poId },
        format: 'JSONEachRow',
      });
      return (await r.json<{ c: string }[]>())[0].c === '2'; // bronze: both land (append-only)
    });

    // force a merge so ReplacingMergeTree collapses duplicates for this test
    await stack.ch.command({ query: `OPTIMIZE TABLE silver.purchase_order FINAL` });

    const r = await stack.ch.query({
      query: `SELECT count() as c FROM silver.purchase_order WHERE po_id = {id:String} AND version = 4000`,
      query_params: { id: poId },
      format: 'JSONEachRow',
    });
    expect((await r.json<{ c: string }[]>())[0].c).toBe('1'); // silver: deduped to one
  });

  it('propagates a delete event as is_deleted=1, removing the row from current-state reads', async () => {
    const deleteEvent = { ts_ms: 5000, op: 'd' };
    await produceRaw(stack, 'erp.cdc.purchase_order', poId, [deleteEvent]);

    await waitForCondition(async () => {
      const r = await stack.ch.query({
        query: `
          SELECT argMax(is_deleted, version) as deleted
          FROM silver.purchase_order WHERE po_id = {id:String} GROUP BY po_id`,
        query_params: { id: poId },
        format: 'JSONEachRow',
      });
      const rows = await r.json<{ deleted: string }[]>();
      return rows[0]?.deleted === '1';
    });
  });
});
