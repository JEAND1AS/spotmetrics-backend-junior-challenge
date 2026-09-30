import { NotFoundException } from '@nestjs/common';
import { ExecutionsService } from './executions.service';
import { ExecutionStatus } from './execution-status.enum';

const agent = { id: 'a1', name: 'Bot', active: true, monthlyTokenLimit: 10 };

function build(overrides: { usage?: number; agent?: object | null; publishFails?: boolean } = {}) {
  const agents = { findOne: jest.fn().mockResolvedValue(overrides.agent === undefined ? agent : overrides.agent) };
  const executions = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'e1', ...x })),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
  };
  const usage = {
    findOne: jest.fn().mockResolvedValue(overrides.usage === undefined ? null : { tokensUsed: overrides.usage }),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => x),
  };
  const rabbit = {
    publish: overrides.publishFails
      ? jest.fn(() => {
          throw new Error('broker down');
        })
      : jest.fn(),
  };
  const service = new ExecutionsService(agents as any, executions as any, usage as any, rabbit as any);
  return { service, agents, executions, usage, rabbit };
}

describe('ExecutionsService.create', () => {
  it('creates a PENDING execution and publishes to the queue', async () => {
    const { service, rabbit } = build();
    const result = await service.create('a1', { input: 'one two three' });
    expect(result.status).toBe(ExecutionStatus.PENDING);
    expect(result.inputTokens).toBe(3);
    expect(rabbit.publish).toHaveBeenCalledWith(expect.any(String), { executionId: 'e1' });
  });

  it('throws 404 when agent does not exist', async () => {
    const { service } = build({ agent: null });
    await expect(service.create('x', { input: 'hi' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects inactive agents with 409 before saving or publishing an execution', async () => {
    const { service, executions, usage, rabbit } = build({ agent: { ...agent, active: false } });

    await expect(service.create('a1', { input: 'hello' })).rejects.toMatchObject({
      status: 409,
      message: 'Agent a1 is inactive',
    });
    expect(usage.findOne).not.toHaveBeenCalled();
    expect(executions.create).not.toHaveBeenCalled();
    expect(executions.save).not.toHaveBeenCalled();
    expect(rabbit.publish).not.toHaveBeenCalled();
  });

  it('returns 429 when the monthly limit would be exceeded', async () => {
    const { service, rabbit } = build({ usage: 9 });
    await expect(service.create('a1', { input: 'one two' })).rejects.toMatchObject({ status: 429 });
    expect(rabbit.publish).not.toHaveBeenCalled();
  });

  it('marks the execution FAILED when the queue is unavailable', async () => {
    const { service, executions } = build({ publishFails: true });
    await expect(service.create('a1', { input: 'hi' })).rejects.toMatchObject({ status: 503 });
    const lastSave = executions.save.mock.calls.at(-1)?.[0];
    expect(lastSave.status).toBe(ExecutionStatus.FAILED);
  });
});

describe('ExecutionsService.addTokensUsed', () => {
  it('creates the monthly row on first use', async () => {
    const { service, usage } = build();
    await service.addTokensUsed('a1', '2026-09', 5);
    expect(usage.save).toHaveBeenCalledWith(expect.objectContaining({ tokensUsed: 5 }));
  });

  it('adds to the existing monthly total', async () => {
    const { service, usage } = build({ usage: 7 });
    await service.addTokensUsed('a1', '2026-09', 5);
    expect(usage.save).toHaveBeenCalledWith(expect.objectContaining({ tokensUsed: 12 }));
  });
});
