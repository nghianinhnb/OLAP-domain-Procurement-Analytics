import { Kafka } from 'kafkajs';
import { PurchaseOrderCdcEventSchema, PURCHASE_ORDER_TOPIC } from '@repo/contracts';

/**
 * NOTE on architecture: the primary bronze ingestion path is the ClickHouse
 * `Kafka Engine` + `Materialized View` defined in clickhouse-schema (bronze/001_*.sql) —
 * ClickHouse consumes Kafka directly, no app-level consumer needed for the happy path.
 *
 * This app's job is narrower: validate messages against the shared contract and
 * route anything that fails validation to a dead-letter topic, since ClickHouse's
 * Kafka Engine will silently drop rows that don't match the target schema.
 * Run this as a small side-car consumer group, independent of ClickHouse's own group.
 */

const kafka = new Kafka({ clientId: 'olap-ingest-validator', brokers: ['kafka:9092'] });
const consumer = kafka.consumer({ groupId: 'olap-ingest-validator-po' });
const producer = kafka.producer();

export async function runPurchaseOrderValidator(): Promise<void> {
  await consumer.connect();
  await producer.connect();
  await consumer.subscribe({ topic: PURCHASE_ORDER_TOPIC, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const raw = message.value?.toString();
      if (!raw) return;

      const parsed = PurchaseOrderCdcEventSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        await producer.send({
          topic: `${PURCHASE_ORDER_TOPIC}.dlq`,
          messages: [{ value: JSON.stringify({ raw, errors: parsed.error.issues }) }],
        });
        // metrics/alerting hook goes here — a rising DLQ rate usually means
        // the BE outbox shape drifted from the contracts package.
      }
    },
  });
}
