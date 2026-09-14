import { Kafka, Producer } from 'kafkajs';
import { TestStack } from '../test-stack';

const producers = new Map<string, Producer>();

export async function produceRaw(
  stack: TestStack,
  topic: string,
  key: string,
  events: Record<string, unknown>[]
): Promise<void> {
  const bootstrap = stack.kafka.getBootstrapServers();
  let producer = producers.get(bootstrap);

  if (!producer) {
    const kafka = new Kafka({
      clientId: 'test-producer',
      brokers: [bootstrap],
    });
    producer = kafka.producer();
    await producer.connect();
    producers.set(bootstrap, producer);
  }

  await producer.send({
    topic,
    messages: events.map((event) => ({
      key,
      value: JSON.stringify(event),
    })),
  });
}
