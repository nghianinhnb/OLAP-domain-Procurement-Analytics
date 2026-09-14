import { startTestStack, stopTestStack, waitForCondition, TestStack } from './test-stack';
import { produceRaw } from './helpers/produce-raw';

describe('SCD2: gold.dim_vendor close-out (integration)', () => {
  let stack: TestStack;
  const vendorId = 'c4d5e6f7-3333-4a2b-9c3d-000000000003';

  beforeAll(async () => {
    stack = await startTestStack();
  }, 60_000);

  afterAll(async () => stopTestStack(stack));

  it('opens a new current row and closes the previous one when a tracked attribute changes', async () => {
    await produceRaw(stack, 'erp.cdc.vendor', vendorId, [
      { ts_ms: 1000, vendor_name: 'Acme Co', vendor_tier: 'STANDARD' },
    ]);
    await waitForCondition(() => rowExistsWithTier(stack, vendorId, 'STANDARD'));

    // run the SCD2 merge job (in real pipeline: triggered by MV/event, not cron)
    await runScd2Merge(stack, 'dim_vendor');

    await produceRaw(stack, 'erp.cdc.vendor', vendorId, [
      { ts_ms: 2000, vendor_name: 'Acme Co', vendor_tier: 'PREFERRED' }, // tier upgraded
    ]);
    await waitForCondition(() => rowExistsWithTier(stack, vendorId, 'PREFERRED'));
    await runScd2Merge(stack, 'dim_vendor');

    const rows = await queryAll(stack, `
      SELECT vendor_tier, is_current, valid_from, valid_to
      FROM gold.dim_vendor WHERE vendor_id = {id:String} ORDER BY valid_from`,
      { id: vendorId },
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ vendor_tier: 'STANDARD', is_current: '0' });
    expect(rows[0].valid_to).not.toBe('9999-12-31 00:00:00.000'); // was closed out
    expect(rows[1]).toMatchObject({ vendor_tier: 'PREFERRED', is_current: '1' });

    // invariant that matters most for point-in-time joins downstream:
    expect(rows[0].valid_to).toBe(rows[1].valid_from);
  });

  it('does NOT create a new row when an untracked attribute changes', async () => {
    // e.g. correcting a typo in an internal notes field that isn't in the tracked list
    await produceRaw(stack, 'erp.cdc.vendor', vendorId, [
      { ts_ms: 3000, vendor_name: 'Acme Co', vendor_tier: 'PREFERRED', internal_notes: 'fixed typo' },
    ]);
    await runScd2Merge(stack, 'dim_vendor');

    const rows = await queryAll(stack, `SELECT count() as c FROM gold.dim_vendor WHERE vendor_id = {id:String}`, {
      id: vendorId,
    });
    expect(rows[0].c).toBe('2'); // still 2, not 3 — untracked change must not fork history
  });
});

async function rowExistsWithTier(stack: TestStack, vendorId: string, tier: string): Promise<boolean> {
  try {
    const rows = await queryAll<{ c: string }>(
      stack,
      `SELECT count() as c FROM silver.vendor WHERE vendor_id = {id:String} AND vendor_tier = {tier:String}`,
      { id: vendorId, tier }
    );
    return Number(rows[0]?.c || 0) > 0;
  } catch {
    return false;
  }
}

async function runScd2Merge(stack: TestStack, table: string): Promise<void> {
  if (table === 'dim_vendor') {
    // 1. Fetch latest silver state vs current gold state for changed tracked attributes
    const changed = await queryAll<{
      vendor_id: string;
      vendor_name: string;
      vendor_tier: string;
      country_code: string;
      version: string;
    }>(
      stack,
      `
      WITH current_gold AS (
        SELECT vendor_id, vendor_name, vendor_tier, country_code
        FROM gold.dim_vendor
        WHERE is_current = 1
      ),
      latest_silver AS (
        SELECT
          vendor_id,
          argMax(vendor_name, version) as vendor_name,
          argMax(vendor_tier, version) as vendor_tier,
          argMax(country_code, version) as country_code,
          max(version) as version
        FROM silver.vendor
        GROUP BY vendor_id
        HAVING argMax(is_deleted, version) = 0
      )
      SELECT l.vendor_id, l.vendor_name, l.vendor_tier, l.country_code, l.version
      FROM latest_silver l
      LEFT JOIN current_gold c USING (vendor_id)
      WHERE c.vendor_id IS NULL
         OR c.vendor_name != l.vendor_name
         OR c.vendor_tier != l.vendor_tier
         OR c.country_code != l.country_code
      `
    );

    for (const row of changed) {
      const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
      // Close out previous active version
      await stack.ch.command({
        query: `
          ALTER TABLE gold.dim_vendor UPDATE
            valid_to = toDateTime64({now:String}, 3),
            is_current = 0
          WHERE vendor_id = {id:String} AND is_current = 1
        `,
        query_params: { now, id: row.vendor_id },
      });

      // Insert new version
      await stack.ch.command({
        query: `
          INSERT INTO gold.dim_vendor (vendor_sk, vendor_id, vendor_name, vendor_tier, country_code, valid_from, valid_to, is_current, version)
          VALUES (
            cityHash64({id:String}, toUnixTimestamp64Milli(toDateTime64({now:String}, 3))),
            {id:String},
            {name:String},
            {tier:String},
            {country:String},
            toDateTime64({now:String}, 3),
            toDateTime64('9999-12-31 00:00:00.000', 3),
            1,
            {ver:UInt64}
          )
        `,
        query_params: {
          id: row.vendor_id,
          name: row.vendor_name,
          tier: row.vendor_tier,
          country: row.country_code || 'VN',
          now,
          ver: Number(row.version),
        },
      });
    }
  }
}

async function queryAll<T = Record<string, unknown>>(
  stack: TestStack,
  query: string,
  params?: Record<string, unknown>
): Promise<T[]> {
  const result = await stack.ch.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });
  return result.json<T[]>();
}

