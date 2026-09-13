import { Controller, Get, Query } from '@nestjs/common';
import { METRICS, MetricName } from '@repo/metrics-definitions';
import { SpendService } from './spend.service';

@Controller('metrics')
export class SpendController {
  constructor(private readonly spendService: SpendService) {}

  @Get()
  async getMetric(
    @Query('metric') metric: MetricName,
    @Query('groupBy') groupBy: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!(metric in METRICS)) {
      return { error: `Unknown metric: ${metric}` };
    }
    // Short TTL cache here (e.g. 30-60s) — dashboards rarely need sub-minute
    // freshness, and it takes real load off ClickHouse during traffic spikes.
    return this.spendService.query(metric, groupBy, from, to);
  }
}
