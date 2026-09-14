#!/usr/bin/env node
/**
 * Scheduled reconciliation job (cron/Airflow), NOT part of the PR test suite.
 * Purpose: catch silent data loss that a healthy-looking pipeline (no errors,
 * no crashed pods) can still produce — e.g. a stuck consumer group, a DLQ
 * quietly filling up, a partition that stopped being consumed.
 *
 * Exit code 0 = within tolerance. Exit code 1 = drift exceeded threshold,
 * intended to page/alert, not to fail a build.
 */
import { Client } from 'pg';
import { createClient } from '@clickhouse/client';

const DRIFT_ROW_COUNT_THRESHOLD = 0.001; // 0.1% — small lag is expected, not an error
const DRIFT_STALE_MINUTES = 60; // if drift persists longer than this, something is actually broken

async function main() {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  const ch = createClient({ host: process.env.CLICKHOUSE_URL });

  const { rows: pgRows } = await pg.query(`
    SELECT count(*) AS row_count,
           sum(('x' || substr(md5(po_id::text || status || total_amount::text), 1, 16))::bit(64)::bigint) AS checksum
    FROM purchase_order WHERE deleted_at IS NULL
  `);

  const chResult = await ch.query({
    query: `
      SELECT count() AS row_count,
             sum(reinterpretAsInt64(reverse(substring(MD5(concat(toString(po_id), status, toString(total_amount))), 1, 8)))) AS checksum
      FROM (
        SELECT po_id, argMax(status, version) AS status, argMax(total_amount, version) AS total_amount
        FROM silver.purchase_order GROUP BY po_id HAVING argMax(is_deleted, version) = 0
      )`,
    format: 'JSONEachRow',
  });
  const [chRows] = await chResult.json<{ row_count: string; checksum: string }[]>();

  const pgCount = Number(pgRows[0].row_count);
  const chCount = Number(chRows.row_count);
  const drift = Math.abs(pgCount - chCount) / pgCount;

  console.log(`[reconciliation] pg=${pgCount} ch=${chCount} drift=${(drift * 100).toFixed(3)}%`);

  if (drift > DRIFT_ROW_COUNT_THRESHOLD) {
    // check whether this is a known transient lag (recent writes still in flight)
    // vs. a sustained gap (query a "first seen drifting at" marker persisted from prior runs)
    await alertOncall({
      title: 'ELT reconciliation drift: purchase_order',
      pgCount,
      chCount,
      driftPct: drift * 100,
    });
    process.exit(1);
  }

  if (pgRows[0].checksum !== chRows.checksum && pgCount === chCount) {
    // same count, different checksum = field-level corruption, not row loss —
    // usually a rounding/timezone/enum-mapping bug in the bronze->silver transform.
    await alertOncall({
      title: 'ELT reconciliation checksum mismatch (row counts match, values differ)',
      pgCount,
      chCount,
    });
    process.exit(1);
  }

  process.exit(0);
}

async function alertOncall(payload: Record<string, unknown>) {
  // wire to PagerDuty/Slack webhook — omitted here
  console.error('[ALERT]', JSON.stringify(payload));
}

main();
