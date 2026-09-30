import { AgentsService } from './agents.service';
import { ExecutionStatus } from '../executions/execution-status.enum';

function build(entities: object[] = [], raw: object[] = []) {
  const dailyQuery = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
  };
  const query = {
    leftJoin: jest.fn().mockImplementation((target) => {
      if (typeof target === 'function' && !target.prototype) target(dailyQuery);
      return query;
    }),
    addSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawAndEntities: jest.fn().mockResolvedValue({ entities, raw }),
  };
  const agents = {
    createQueryBuilder: jest.fn().mockReturnValue(query),
    findOne: jest.fn(),
    save: jest.fn(async (agent) => agent),
  };
  const usage = { findOne: jest.fn() };
  return {
    service: new AgentsService(agents as any, usage as any),
    agents, usage, query, dailyQuery,
  };
}

describe('AgentsService.findAll', () => {
  afterEach(() => jest.useRealTimers());

  it('returns an empty list when there are no agents', async () => {
    const { service } = build();
    await expect(service.findAll()).resolves.toEqual([]);
  });

  it('preserves agent data and associates numeric usage by id without per-agent lookups', async () => {
    const first = { id: 'a1', name: 'Active', active: true, monthlyTokenLimit: 100 };
    const second = { id: 'a2', name: 'Inactive', active: false, monthlyTokenLimit: 200 };
    const { service, usage, agents, query } = build([first, second], [
      { agent_id: 'a2', tokensUsedThisMonth: '80', tokensUsedToday: '15' },
      { agent_id: 'a1', tokensUsedThisMonth: '30', tokensUsedToday: '10' },
    ]);
    await expect(service.findAll()).resolves.toEqual([
      { ...first, tokensUsedThisMonth: 30, tokensRemainingThisMonth: 70, tokensUsedToday: 10 },
      { ...second, tokensUsedThisMonth: 80, tokensRemainingThisMonth: 120, tokensUsedToday: 15 },
    ]);
    expect(query.getRawAndEntities).toHaveBeenCalledTimes(1);
    expect(agents.findOne).not.toHaveBeenCalled();
    expect(usage.findOne).not.toHaveBeenCalled();
  });

  it('returns zero usage and the full balance for an agent without consumption', async () => {
    const agent = { id: 'a1', monthlyTokenLimit: 100 };
    const { service } = build([agent], [
      { agent_id: 'a1', tokensUsedThisMonth: 0, tokensUsedToday: '0' },
    ]);
    await expect(service.findAll()).resolves.toEqual([
      { ...agent, tokensUsedThisMonth: 0, tokensRemainingThisMonth: 100, tokensUsedToday: 0 },
    ]);
  });

  it.each([100, 120])('clamps the remaining balance to zero when usage is %s', async (tokensUsedThisMonth) => {
    const { service } = build([{ id: 'a1', monthlyTokenLimit: 100 }], [
      { agent_id: 'a1', tokensUsedThisMonth, tokensUsedToday: 10 },
    ]);
    expect((await service.findAll())[0].tokensRemainingThisMonth).toBe(0);
  });

  it('uses the UTC month and completion-day boundaries even across a local month boundary', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-30T22:30:00-03:00'));
    const { service, query, dailyQuery } = build();
    await service.findAll();
    expect(query.leftJoin).toHaveBeenCalledWith(
      expect.any(Function), 'usage', expect.any(String), { month: '2026-10' },
    );
    expect(dailyQuery.where).toHaveBeenCalledWith(
      'execution.status = :completed', { completed: ExecutionStatus.COMPLETED },
    );
    expect(dailyQuery.andWhere).toHaveBeenCalledWith(
      'execution.completedAt >= :dayStart AND execution.completedAt < :dayEnd',
      { dayStart: new Date('2026-10-01T00:00:00Z'), dayEnd: new Date('2026-10-02T00:00:00Z') },
    );
  });
});

describe('AgentsService.getUsage', () => {
  it('preserves the historical monthly usage response', async () => {
    const { service, agents, usage } = build();
    agents.findOne.mockResolvedValue({ id: 'a1', monthlyTokenLimit: 100 });
    usage.findOne.mockResolvedValue({ tokensUsed: 35 });
    await expect(service.getUsage('a1', '2026-08')).resolves.toEqual({
      agentId: 'a1', month: '2026-08', monthlyTokenLimit: 100, tokensUsed: 35, tokensRemaining: 65,
    });
    expect(usage.findOne).toHaveBeenCalledWith({ where: { agentId: 'a1', month: '2026-08' } });
  });
});


describe('AgentsService update and deactivate', () => {
  it('updates supplied fields and preserves omitted values', async () => {
    const { service, agents } = build();
    agents.findOne.mockResolvedValue({ id: 'a1', name: 'Before', systemPrompt: 'Keep this prompt', monthlyTokenLimit: 100, active: true, description: 'Before' });
    await expect(service.update('a1', { name: 'After', active: false, description: null })).resolves.toEqual({
      id: 'a1', name: 'After', systemPrompt: 'Keep this prompt', monthlyTokenLimit: 100, active: false, description: null,
    });
  });

  it('deactivates without deleting the agent and is idempotent', async () => {
    const { service, agents, usage } = build();
    const agent = { id: 'a1', active: true };
    agents.findOne.mockResolvedValue(agent);
    await service.deactivate('a1');
    await service.deactivate('a1');
    expect(agents.save).toHaveBeenCalledTimes(1);
    expect(agents.save).toHaveBeenCalledWith({ id: 'a1', active: false });
    expect(usage.findOne).not.toHaveBeenCalled();
    await expect(service.findOne('a1')).resolves.toEqual({ id: 'a1', active: false });
  });

  it('allows reactivating an agent', async () => {
    const { service, agents } = build();
    agents.findOne.mockResolvedValue({ id: 'a1', active: false });
    await expect(service.update('a1', { active: true })).resolves.toMatchObject({ active: true });
  });

  it('rejects updates and deactivation of missing agents', async () => {
    const { service, agents } = build();
    agents.findOne.mockResolvedValue(null);
    await expect(service.update('missing', { name: 'New' })).rejects.toMatchObject({ status: 404 });
    await expect(service.deactivate('missing')).rejects.toMatchObject({ status: 404 });
    expect(agents.save).not.toHaveBeenCalled();
  });
});
