import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ExecutionsController } from './executions.controller';
import { ExecutionsService } from './executions.service';
import { ListExecutionsQueryDto, ExecutionOrder } from './dto/list-executions-query.dto';
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
    const { service, rabbit } = build({ agent: { ...agent, monthlyTokenLimit: 11 } });
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


describe('ExecutionsService history', () => {
  it('paginates, filters by agent and status, and sorts with a stable tiebreaker', async () => {
    const { service, executions } = build();
    executions.findAndCount.mockResolvedValue([[{ id: 'e2' }], 6]);
    await expect(service.findByAgent('a1', { page: 2, limit: 5, status: ExecutionStatus.FAILED, order: ExecutionOrder.ASC })).resolves.toEqual({
      data: [{ id: 'e2' }], total: 6, page: 2, limit: 5, totalPages: 2,
    });
    expect(executions.findAndCount).toHaveBeenCalledWith({
      where: { agentId: 'a1', status: ExecutionStatus.FAILED },
      order: { createdAt: 'ASC', id: 'ASC' }, skip: 5, take: 5,
    });
  });

  it('returns an empty history for inactive agents without executions', async () => {
    const { service, executions } = build({ agent: { ...agent, active: false } });
    executions.findAndCount.mockResolvedValue([[], 0]);
    await expect(service.findByAgent('a1', new ListExecutionsQueryDto())).resolves.toEqual({
      data: [], total: 0, page: 1, limit: 20, totalPages: 0,
    });
    expect(executions.findAndCount).toHaveBeenCalledWith({
      where: { agentId: 'a1' }, order: { createdAt: 'DESC', id: 'DESC' }, skip: 0, take: 20,
    });
  });

  it('returns empty data beyond the last page, preserving the total', async () => {
    const { service, executions } = build();
    executions.findAndCount.mockResolvedValue([[], 1]);
    await expect(service.findByAgent('a1', { page: 3, limit: 20, order: ExecutionOrder.DESC })).resolves.toMatchObject({
      data: [], total: 1, totalPages: 1, page: 3,
    });
  });

  it('returns 404 for missing agents before querying executions', async () => {
    const { service, executions } = build({ agent: null });
    await expect(service.findByAgent('missing', new ListExecutionsQueryDto())).rejects.toMatchObject({ status: 404 });
    await expect(service.getMetrics('missing')).rejects.toMatchObject({ status: 404 });
    expect(executions.findAndCount).not.toHaveBeenCalled();
  });
});

describe('ExecutionsService monthly limit', () => {
  it.each([
    { usage: 4, agent, requiredTokens: 7 },
    { usage: 0, agent: { ...agent, monthlyTokenLimit: 6 }, requiredTokens: 7 },
    { usage: 3, agent: { ...agent, name: 'Support Bot' }, requiredTokens: 8 },
  ])('rejects when input fits but the total cost exceeds the balance (case %#)', async (scenario) => {
    const { service, executions, rabbit, usage } = build(scenario);
    await expect(service.create('a1', { input: 'one' })).rejects.toMatchObject({
      status: 429,
      response: {
        statusCode: 429,
        message: 'Monthly token limit exceeded',
        monthlyTokenLimit: scenario.agent.monthlyTokenLimit,
        tokensUsed: scenario.usage,
        requiredTokens: scenario.requiredTokens,
      },
    });
    expect(executions.create).not.toHaveBeenCalled();
    expect(executions.save).not.toHaveBeenCalled();
    expect(rabbit.publish).not.toHaveBeenCalled();
    expect(usage.save).not.toHaveBeenCalled();
  });

  it('accepts an execution when the balance exactly covers input and output', async () => {
    const { service, rabbit, usage } = build({ usage: 3 });
    await expect(service.create('a1', { input: 'one' })).resolves.toMatchObject({
      status: ExecutionStatus.PENDING, inputTokens: 1,
    });
    expect(rabbit.publish).toHaveBeenCalledWith(expect.any(String), { executionId: 'e1' });
    expect(usage.save).not.toHaveBeenCalled();
  });

  it.each([10, 11])('rejects exhausted usage %s without saving or publishing', async (used) => {
    const { service, executions, rabbit } = build({ usage: used });
    await expect(service.create('a1', { input: 'one' })).rejects.toMatchObject({ status: 429 });
    expect(executions.save).not.toHaveBeenCalled();
    expect(rabbit.publish).not.toHaveBeenCalled();
  });

  it('uses the current UTC month so a previous month does not block new executions', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T00:00:00Z'));
    try {
      const { service, usage } = build();
      await expect(service.create('a1', { input: 'one' })).resolves.toMatchObject({ status: ExecutionStatus.PENDING });
      expect(usage.findOne).toHaveBeenCalledWith({ where: { agentId: 'a1', month: '2026-10' } });
    } finally {
      jest.useRealTimers();
    }
  });
});


describe('POST /agents/:agentId/executions token balance', () => {
  it('returns HTTP 429 without creating or enqueueing when input fits but output does not', async () => {
    const { service, executions, rabbit } = build({ usage: 4 });
    const module = await Test.createTestingModule({
      controllers: [ExecutionsController],
      providers: [{ provide: ExecutionsService, useValue: service }],
    }).compile();
    const app = module.createNestApplication();
    try {
      await app.listen(0, '127.0.0.1');
      const response = await fetch(`${await app.getUrl()}/agents/3b4f8f6e-1c2d-4a5b-9e8f-000000000001/executions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'one' }),
      });
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({
        statusCode: 429, message: 'Monthly token limit exceeded',
        monthlyTokenLimit: 10, tokensUsed: 4, requiredTokens: 7,
      });
      expect(executions.save).not.toHaveBeenCalled();
      expect(rabbit.publish).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});


describe('ExecutionsService metrics', () => {
  it.each([
    [{ totalExecutions: '5', completedExecutions: '2', failedExecutions: '1', totalTokens: '31', averageTokensPerExecution: '15.5' },
      { totalExecutions: 5, completedExecutions: 2, failedExecutions: 1, totalTokens: 31, averageTokensPerExecution: 15.5 }],
    [{ totalExecutions: '0', completedExecutions: '0', failedExecutions: '0', totalTokens: '0', averageTokensPerExecution: '0' },
      { totalExecutions: 0, completedExecutions: 0, failedExecutions: 0, totalTokens: 0, averageTokensPerExecution: 0 }],
  ])('returns numeric aggregates without losing fractional averages (case %#)', async (row, expected) => {
    const { service, executions } = build({ agent: { ...agent, active: false } });
    const query = {
      select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(), setParameters: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(row),
    };
    Object.assign(executions, { createQueryBuilder: jest.fn().mockReturnValue(query) });
    await expect(service.getMetrics('a1')).resolves.toEqual({ agentId: 'a1', ...expected });
    expect(query.where).toHaveBeenCalledWith('execution.agentId = :agentId', { agentId: 'a1' });
    expect(query.setParameters).toHaveBeenCalledWith({ completed: 'COMPLETED', failed: 'FAILED' });
  });
});
