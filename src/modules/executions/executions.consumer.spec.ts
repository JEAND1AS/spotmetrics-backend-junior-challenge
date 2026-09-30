import { ConsumeMessage } from 'amqplib';
import { ExecutionsConsumer } from './executions.consumer';
import { ExecutionStatus } from './execution-status.enum';
import { Agent } from '../agents/agent.entity';
import { AgentExecution } from './agent-execution.entity';

// Transaction mocks exercise business rules; PostgreSQL tests cover rollback and locks.
describe('ExecutionsConsumer.process', () => {
  let originalDelay: string | undefined;
  beforeEach(() => {
    originalDelay = process.env.PROCESSING_DELAY_MS;
    process.env.PROCESSING_DELAY_MS = '0';
  });
  afterEach(() => {
    if (originalDelay === undefined) delete process.env.PROCESSING_DELAY_MS;
    else process.env.PROCESSING_DELAY_MS = originalDelay;
  });

  function build(status = ExecutionStatus.PENDING, used = 0, limit = 100) {
    const execution = { id: 'e1', agentId: 'a1', input: 'hello', inputTokens: 1, status };
    const agent = { id: 'a1', name: 'Bot', active: true, monthlyTokenLimit: limit };
    const agents = { findOne: jest.fn().mockResolvedValue(agent) };
    const usage = {
      findOne: jest.fn().mockResolvedValue({ agentId: 'a1', tokensUsed: used }),
      create: jest.fn(x => x), save: jest.fn(async x => x),
    };
    const executions = {
      findOne: jest.fn().mockResolvedValue(execution),
      save: jest.fn(async x => x),
      update: jest.fn(async (where, changes) => {
        if (execution.status === where.status) Object.assign(execution, changes);
      }),
      manager: { transaction: jest.fn(async callback => callback({
        getRepository: entity => entity === Agent ? agents : entity === AgentExecution ? executions : usage,
      })) },
    };
    const consumer = new ExecutionsConsumer(executions as any, {} as any);
    return { consumer, execution, executions, agents, usage };
  }

  it('completes and charges input plus output once on redelivery', async () => {
    const { consumer, execution, usage } = build();
    await consumer.process('e1');
    await consumer.process('e1');
    expect(execution.status).toBe(ExecutionStatus.COMPLETED);
    expect(usage.save).toHaveBeenCalledTimes(1);
    expect(usage.save).toHaveBeenCalledWith(expect.objectContaining({ tokensUsed: 7 }));
  });

  it.each([ExecutionStatus.COMPLETED, ExecutionStatus.FAILED])('skips terminal status %s', async status => {
    const { consumer, executions, usage } = build(status);
    await consumer.process('e1');
    expect(executions.update).not.toHaveBeenCalled();
    expect(usage.save).not.toHaveBeenCalled();
  });

  it('resumes PROCESSING without resetting startedAt', async () => {
    const { consumer, execution } = build(ExecutionStatus.PROCESSING);
    const startedAt = new Date('2026-01-01T00:00:00Z');
    Object.assign(execution, { startedAt });
    await consumer.process('e1');
    expect(execution).toMatchObject({ status: ExecutionStatus.COMPLETED, startedAt });
  });

  it.each([9, 10, 11])('fails when total tokens exceed remaining quota (used %s)', async used => {
    const { consumer, execution, usage } = build(ExecutionStatus.PENDING, used, 10);
    await consumer.process('e1');
    expect(execution).toMatchObject({ status: ExecutionStatus.FAILED, error: expect.stringContaining('Monthly token limit exceeded') });
    expect(execution).not.toHaveProperty('output');
    expect(usage.save).not.toHaveBeenCalled();
  });

  it('allows exact remaining quota', async () => {
    const { consumer, execution, usage } = build(ExecutionStatus.PENDING, 3, 10);
    await consumer.process('e1');
    expect(execution.status).toBe(ExecutionStatus.COMPLETED);
    expect(usage.save).toHaveBeenCalledWith(expect.objectContaining({ tokensUsed: 10 }));
  });

  it('creates the first usage row in the completion month', async () => {
    const { consumer, execution, usage } = build();
    usage.findOne.mockResolvedValueOnce(null);
    await consumer.process('e1');
    const month = (execution as any).completedAt.toISOString().slice(0, 7);
    expect(usage.save).toHaveBeenCalledWith({ agentId: 'a1', month, tokensUsed: 7 });
  });

  it.each([null, { id: 'a1', active: false }])('fails missing or inactive agent without charging: %j', async agent => {
    const { consumer, execution, agents, usage } = build();
    agents.findOne.mockResolvedValueOnce(agent);
    await consumer.process('e1');
    expect(execution.status).toBe(ExecutionStatus.FAILED);
    expect(usage.save).not.toHaveBeenCalled();
  });

  it('skips unknown executions', async () => {
    const { consumer, executions } = build();
    executions.findOne.mockResolvedValueOnce(null);
    await consumer.process('missing');
    expect(executions.update).not.toHaveBeenCalled();
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
      {} as any, { getChannel: () => channel } as any,
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
