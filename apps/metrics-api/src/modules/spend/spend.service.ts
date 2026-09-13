import { Injectable } from '@nestjs/common';
import { createClient } from '@clickhouse/client';
import { METRICS, MetricName } from '@repo/metrics-definitions';

@Injectable()
export class SpendService {
  private readonly client = createClient({ host: process.env.CLICKHOUSE_URL });

  async query(metricName: MetricName, groupBy: string, from: string, to: string) {
    const def = METRICS[metricName];

    if (!def.allowedDimensions.includes(groupBy as never)) {
      throw new Error(`Dimension "${groupBy}" is not allowed for metric "${metricName}"`);
    }

    // groupBy is validated against an allow-list above, never interpolated raw from
    // arbitrary client input — this is the one place UI-facing SQL is assembled,
    // which is the whole point of centralizing this in metrics-api instead of
    // letting each FE feature write its own ClickHouse query.
    const sql = `
      SELECT ${groupBy} AS dimension, ${def.measure} AS value
      FROM ${def.table}
      WHERE ${def.defaultFilter}
        AND date_key BETWEEN {from:UInt32} AND {to:UInt32}
      GROUP BY ${groupBy}
      ORDER BY value DESC
      LIMIT 100
    `;

    const result = await this.client.query({
      query: sql,
      query_params: { from: Number(from), to: Number(to) },
      format: 'JSONEachRow',
    });

    return result.json();
  }
}
