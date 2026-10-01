import { randomUUID } from 'node:crypto';
import { GetMessage } from 'amqplib';
import { RabbitMQService } from './rabbitmq.service';
import { ExecutionsConsumer } from '../../modules/executions/executions.consumer';

// Uses unique test queues on the configured broker; never touches agent-executions.
const describeRabbit = process.env.TEST_RABBITMQ_INTEGRATION === '1' ? describe : describe.skip;
describeRabbit('RabbitMQ confirmations and worker retries', () => {
  let service: RabbitMQService;
  let queue: string;
  const executionId = randomUUID();
  const variables = ['RABBITMQ_EXECUTIONS_QUEUE', 'RABBITMQ_MAX_ATTEMPTS', 'RABBITMQ_RETRY_DELAY_MS'] as const;
  let original: (string | undefined)[];

  beforeEach(async () => {
    original = variables.map(name => process.env[name]);
    queue = `worker_test_${randomUUID()}`;
    process.env.RABBITMQ_EXECUTIONS_QUEUE = queue;
    process.env.RABBITMQ_MAX_ATTEMPTS = '3';
    process.env.RABBITMQ_RETRY_DELAY_MS = '25';
    service = new RabbitMQService();
    await service.onModuleInit();
  });

  afterEach(async () => {
    try {
      await service.getChannel()?.deleteQueue(queue);
      await service.getChannel()?.deleteQueue(`${queue}.failed`);
    } finally {
      await service.onModuleDestroy();
      variables.forEach((name, index) => {
        if (original[index] === undefined) delete process.env[name];
        else process.env[name] = original[index];
      });
    }
  });

  async function waitFor<T>(read: () => Promise<T>, matches: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const value = await read();
      if (matches(value)) return value;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Timed out waiting for test queue state');
  }

  async function startWorker(failures: number) {
    const worker = new ExecutionsConsumer({} as any, service);
    const process = jest.spyOn(worker, 'process').mockResolvedValue(undefined);
    for (let index = 0; index < failures; index++) process.mockRejectedValueOnce(new Error('Simulated database failure'));
    await worker.onModuleInit();
    return process;
  }

  it('confirms a persistent message that can be read from the queue', async () => {
    await service.publish(queue, { executionId });
    const message = await service.getChannel().get(queue, { noAck: false });
    expect(message).not.toBe(false);
    if (!message) throw new Error('Published message missing');
    expect(JSON.parse(message.content.toString())).toEqual({ executionId });
    expect(message.properties).toMatchObject({ deliveryMode: 2, contentType: 'application/json' });
    service.getChannel().ack(message);
  });

  it('rejects unroutable messages even though the broker confirms the publication', async () => {
    await expect(service.publish(`${queue}.missing`, { executionId })).rejects.toThrow('could not be routed');
    expect(service.isConnected()).toBe(true);
  });

  it('recovers on the second attempt without creating a failed message', async () => {
    const process = await startWorker(1);
    await service.publish(queue, { executionId });
    await waitFor(async () => process.mock.calls.length, count => count === 2);
    await waitFor(() => service.getChannel().checkQueue(queue), state => state.messageCount === 0);
    expect((await service.getChannel().checkQueue(`${queue}.failed`)).messageCount).toBe(0);
  });

  it('parks a message after three failures, preserving its id and failure details', async () => {
    const process = await startWorker(3);
    await service.publish(queue, { executionId });
    const message = await waitFor(
      () => service.getChannel().get(`${queue}.failed`, { noAck: false }),
      value => value !== false,
    ) as GetMessage;
    expect(process).toHaveBeenCalledTimes(3);
    expect(JSON.parse(message.content.toString())).toEqual({ executionId });
    expect(message.properties.headers).toMatchObject({
      'x-attempts': 3, 'x-retry-count': 2, 'x-last-error': 'Simulated database failure',
    });
    service.getChannel().ack(message);
    expect((await service.getChannel().checkQueue(queue)).messageCount).toBe(0);
  });

  it('honors a persisted retry counter when a new worker consumes the message', async () => {
    await service.publish(queue, { executionId }, { 'x-retry-count': 1 });
    const process = await startWorker(2);
    const message = await waitFor(
      () => service.getChannel().get(`${queue}.failed`, { noAck: false }),
      value => value !== false,
    ) as GetMessage;
    expect(process).toHaveBeenCalledTimes(2);
    expect(message.properties.headers?.['x-attempts']).toBe(3);
    service.getChannel().ack(message);
  });

  it('cancels consumption and retains the original if the failed queue disappears', async () => {
    const process = await startWorker(1);
    await service.getChannel().deleteQueue(`${queue}.failed`);
    await service.publish(queue, { executionId }, { 'x-retry-count': 2 });
    await waitFor(() => service.getChannel().checkQueue(queue), state => state.consumerCount === 0 && state.messageCount === 1);
    expect(process).toHaveBeenCalledTimes(1);
    const message = await service.getChannel().get(queue, { noAck: false });
    expect(message).not.toBe(false);
    if (!message) throw new Error('Original delivery was lost');
    expect(JSON.parse(message.content.toString())).toEqual({ executionId });
    service.getChannel().ack(message);
  });
});
