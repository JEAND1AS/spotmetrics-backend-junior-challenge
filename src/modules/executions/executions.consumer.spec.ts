import { ConsumeMessage } from 'amqplib';
import { ExecutionsConsumer } from './executions.consumer';
import { ExecutionStatus } from './execution-status.enum';

describe('ExecutionsConsumer.process', () => {
  beforeEach(() => {
    process.env.PROCESSING_DELAY_MS = '0';
  });

  function build(execution: object | null, agent: object | null) {
    const agents = { findOne: jest.fn().mockResolvedValue(agent) };
    const executions = { findOne: jest.fn().mockResolvedValue(execution), save: jest.fn(async (x) => x) };
    const service = { addTokensUsed: jest.fn() };
    const consumer = new ExecutionsConsumer(agents as any, executions as any, service as any, {} as any);
    return { consumer, executions, service };
  }

  it('completes a pending execution and records token usage', async () => {
    const execution = { id: 'e1', agentId: 'a1', input: 'hello world', inputTokens: 2, status: ExecutionStatus.PENDING };
    const { consumer, service } = build(execution, { id: 'a1', name: 'Bot', active: true });

    await consumer.process('e1');

    expect(execution.status).toBe(ExecutionStatus.COMPLETED);
    expect(service.addTokensUsed).toHaveBeenCalledWith('a1', expect.any(String), execution['totalTokens']);
  });

  it('fails when the agent does not exist', async () => {
    const execution = { id: 'e1', agentId: 'a1', input: 'x', inputTokens: 1, status: ExecutionStatus.PENDING };
    const { consumer, service } = build(execution, null);

    await consumer.process('e1');

    expect(execution.status).toBe(ExecutionStatus.FAILED);
    expect(service.addTokensUsed).not.toHaveBeenCalled();
  });

  it('fails queued executions when the agent is inactive without charging tokens', async () => {
    const execution = { id: 'e1', agentId: 'a1', input: 'hello', inputTokens: 1, status: ExecutionStatus.PENDING };
    const { consumer, executions, service } = build(execution, { id: 'a1', name: 'Bot', active: false });

    await consumer.process('e1');

    expect(executions.save).toHaveBeenLastCalledWith(expect.objectContaining({
      status: ExecutionStatus.FAILED,
      error: 'Agent a1 is inactive',
      completedAt: expect.any(Date),
    }));
    expect(execution).not.toHaveProperty('output');
    expect(service.addTokensUsed).not.toHaveBeenCalled();
  });

  it('skips unknown executions', async () => {
    const { consumer, executions } = build(null, null);

    await consumer.process('missing');

    expect(executions.save).not.toHaveBeenCalled();
  });
});

describe('ExecutionsConsumer messages', () => {
  const executionId = '3b4f8f6e-1c2d-4a5b-9e8f-000000000001';

  async function build() {
    let handler: (msg: ConsumeMessage | null) => Promise<void>;
    const channel = {
      assertQueue: jest.fn(),
      prefetch: jest.fn(),
      consume: jest.fn(async (_queue, callback) => { handler = callback; }),
      ack: jest.fn(),
      nack: jest.fn(),
    };
    const consumer = new ExecutionsConsumer(
      {} as any, {} as any, {} as any, { getChannel: () => channel } as any,
    );
    const process = jest.spyOn(consumer, 'process').mockResolvedValue(undefined);
    await consumer.onModuleInit();
    return { channel, process, handle: handler! };
  }

  it.each([
    ['malformed JSON', '{'],
    ['null', 'null'],
    ['array', '[]'],
    ['string', '"hello"'],
    ['number', '123'],
    ['boolean', 'true'],
    ['missing executionId', '{}'],
    ['null executionId', '{"executionId":null}'],
    ['numeric executionId', '{"executionId":123}'],
    ['empty executionId', '{"executionId":""}'],
    ['invalid UUID', '{"executionId":"not-a-uuid"}'],
    ['array executionId', JSON.stringify({ executionId: [executionId] })],
    ['object executionId', '{"executionId":{}}'],
  ])('rejects %s without processing or requeueing', async (_label, content) => {
    const { channel, process, handle } = await build();
    const msg = { content: Buffer.from(content) } as ConsumeMessage;

    await handle(msg);

    expect(process).not.toHaveBeenCalled();
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledTimes(1);
    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
  });

  it('processes and acknowledges a valid message', async () => {
    const { channel, process, handle } = await build();
    const msg = { content: Buffer.from(JSON.stringify({ executionId })) } as ConsumeMessage;

    await handle(msg);

    expect(process).toHaveBeenCalledTimes(1);
    expect(process).toHaveBeenCalledWith(executionId);
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('requeues a valid message when processing fails', async () => {
    const { channel, process, handle } = await build();
    process.mockRejectedValueOnce(new Error('database unavailable'));
    const msg = { content: Buffer.from(JSON.stringify({ executionId })) } as ConsumeMessage;

    await handle(msg);

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
  });

  it('ignores consumer cancellation notifications', async () => {
    const { channel, process, handle } = await build();

    await handle(null);

    expect(process).not.toHaveBeenCalled();
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();
  });
});
