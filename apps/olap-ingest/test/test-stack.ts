import { KafkaContainer, StartedKafkaContainer } from '@testcontainers/kafka';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { createClient, ClickHouseClient } from '@clickhouse/client';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

export interface TestStack {
  kafka: StartedKafkaContainer;
  clickhouse: StartedTestContainer;
  ch: ClickHouseClient;
}

/**
 * Real Kafka + real ClickHouse, not mocks. Engine-specific behavior
 * (ReplacingMergeTree merge timing, Kafka Engine consumption, MV cascades)
 * cannot be faithfully mocked — a mock would just encode our assumptions
 * about the engine, not verify them.
 */
export async function startTestStack(): Promise<TestStack> {
  const kafka = await new KafkaContainer('confluentinc/cp-kafka:7.6.0').withExposedPorts(9093).start();

  const clickhouse = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withExposedPorts(8123)
    .withWaitStrategy(Wait.forHttp('/ping', 8123))
    .start();

  const ch = createClient({
    host: `http://${clickhouse.getHost()}:${clickhouse.getMappedPort(8123)}`,
  });

  // Create databases
  await ch.command({ query: 'CREATE DATABASE IF NOT EXISTS bronze' });
  await ch.command({ query: 'CREATE DATABASE IF NOT EXISTS silver' });
  await ch.command({ query: 'CREATE DATABASE IF NOT EXISTS gold' });

  // Apply schema in dependency order: bronze -> silver -> gold
  const baseMigrationDir = join(__dirname, '../../../packages/clickhouse-schema/migrations');
  for (const layer of ['bronze', 'silver', 'gold']) {
    const dir = join(baseMigrationDir, layer);
    if (existsSync(dir)) {
      const sqlFiles = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
      for (const file of sqlFiles) {
        const fullPath = join(dir, file);
        const content = readFileSync(fullPath, 'utf-8');
        // Split by semicolon for multi-statement execution, filtering out empty queries
        const statements = content
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        for (const statement of statements) {
          try {
            await ch.command({ query: statement });
          } catch (err) {
            console.warn(`[test-stack] Warning applying statement from ${file}:`, err);
          }
        }
      }
    }
  }

  return { kafka, clickhouse, ch };
}

export async function stopTestStack(stack: TestStack): Promise<void> {
  await stack.kafka.stop();
  await stack.clickhouse.stop();
}

export async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}
