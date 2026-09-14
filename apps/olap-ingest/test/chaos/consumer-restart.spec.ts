import { startTestStack, stopTestStack, waitForCondition, TestStack } from '../test-stack';
import { produceRaw } from '../helpers/produce-raw';
import { execSync } from 'child_process';

describe('Chaos: consumer restart mid-stream', () => {
  let stack: TestStack;
  const poId = 'chaos-test-po-0001';

  beforeAll(async () => {
    stack = await startTestStack();
  }, 60_000);

  afterAll(async () => stopTestStack(stack));

  it('resumes from the correct offset after a hard kill, without gaps or duplicates', async () => {
    // Send 50 events, kill the ClickHouse Kafka Engine consumer partway through
    // by detaching+reattaching the table (simulates a pod restart / rebalance),
    // then send the rest. Total count must equal exactly 50 — not 49 (gap),
    // not 51+ (duplicate replay).
    const batch1 = Array.from({ length: 25 }, (_, i) => ({ ts_ms: 1000 + i, seq: i }));
    const batch2 = Array.from({ length: 25 }, (_, i) => ({ ts_ms: 2000 + i, seq: 25 + i }));

    await produceRaw(stack, 'erp.cdc.purchase_order', poId, batch1);

    await waitForCondition(async () => (await countRows(stack, poId)) >= 25);

    // Simulate consumer crash+restart: detach/reattach the Kafka Engine table.
    // This forces ClickHouse to re-negotiate the consumer group, the same
    // failure mode as a pod being OOM-killed or rescheduled.
    await stack.ch.command({ query: `DETACH TABLE bronze.purchase_order_queue` });
    await stack.ch.command({ query: `ATTACH TABLE bronze.purchase_order_queue` });

    await produceRaw(stack, 'erp.cdc.purchase_order', poId, batch2);

    await waitForCondition(async () => (await countRows(stack, poId)) === 50, 30_000);

    const finalCount = await countRows(stack, poId);
    expect(finalCount).toBe(50); // exact — no gap, no duplicate replay
  });
});

async function countRows(stack: TestStack, poId: string): Promise<number> {
  const r = await stack.ch.query({
    query: `SELECT count() as c FROM bronze.purchase_order WHERE po_id = {id:String}`,
    query_params: { id: poId },
    format: 'JSONEachRow',
  });
  return Number((await r.json<{ c: string }[]>())[0].c);
}
