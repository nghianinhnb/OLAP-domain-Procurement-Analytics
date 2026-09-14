import { startTestStack, stopTestStack, waitForCondition, TestStack } from '../test-stack';
import { produceRaw } from '../helpers/produce-raw';

describe('Chaos: malformed message handling', () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await startTestStack();
  }, 60_000);

  afterAll(async () => stopTestStack(stack));

  it('routes a schema-invalid message to the DLQ instead of poisoning the Kafka Engine MV', async () => {
    // ClickHouse's default behavior when a Kafka Engine MV hits a row it can't
    // cast (e.g. a string where a UUID is expected) is to STOP consuming that
    // partition entirely — not skip the bad row. This is the exact failure mode
    // the olap-ingest validator exists to prevent, so it must be tested directly,
    // not assumed to work because "the code looks right".
    await produceRaw(stack, 'erp.cdc.purchase_order', 'malformed-1', [
      { ts_ms: 'not-a-number', vendor_id: 'not-a-uuid' }, // deliberately invalid
    ]);

    await waitForCondition(async () => {
      const r = await stack.ch.query({
        query: `SELECT count() as c FROM bronze.purchase_order_dlq`, // DLQ mirror table in ClickHouse for assertions
        format: 'JSONEachRow',
      });
      return Number((await r.json<{ c: string }[]>())[0].c) >= 1;
    });

    // The critical assertion: subsequent VALID messages must still be consumed.
    // Without this check, a "DLQ received the bad message" pass could hide a
    // consumer that's actually stuck/dead after the bad row.
    await produceRaw(stack, 'erp.cdc.purchase_order', 'valid-after-malformed', [{ ts_ms: 9999, status: 'DRAFT' }]);

    await waitForCondition(async () => {
      const r = await stack.ch.query({
        query: `SELECT count() as c FROM bronze.purchase_order WHERE po_id = 'valid-after-malformed'`,
        format: 'JSONEachRow',
      });
      return Number((await r.json<{ c: string }[]>())[0].c) === 1;
    }, 20_000);
  });
});
