import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { env } from '../../config/env';
import { Agent } from '../agents/agent.entity';
import { AgentMonthlyUsage } from '../agents/agent-monthly-usage.entity';
import { AgentExecution } from './agent-execution.entity';
import { ExecutionsConsumer } from './executions.consumer';
import { ExecutionStatus } from './execution-status.enum';

// Opt in with TEST_DATABASE_INTEGRATION=1. Uses only a newly created, isolated schema.
const describeDatabase = process.env.TEST_DATABASE_INTEGRATION === '1' ? describe : describe.skip;
describeDatabase('Worker transactions in PostgreSQL', () => {
  const schema = `worker_test_${randomUUID().replaceAll('-', '')}`;
  let database: DataSource;
  let consumer: ExecutionsConsumer;
  let originalDelay: string | undefined;

  beforeAll(async () => {
    originalDelay = process.env.PROCESSING_DELAY_MS;
    process.env.PROCESSING_DELAY_MS = '0';
    database = new DataSource({
      type: 'postgres', ...env.database, schema,
      entities: [Agent, AgentExecution, AgentMonthlyUsage], synchronize: false,
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.synchronize();
    consumer = new ExecutionsConsumer(database.getRepository(AgentExecution), {} as any);
  });

  afterAll(async () => {
    if (originalDelay === undefined) delete process.env.PROCESSING_DELAY_MS;
    else process.env.PROCESSING_DELAY_MS = originalDelay;
    if (database?.isInitialized) {
      try { await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
      finally { await database.destroy(); }
    }
  });

  async function createExecution(agentId?: string, limit = 100) {
    if (!agentId) {
      const agent = await database.getRepository(Agent).save({
        name: 'Bot', systemPrompt: 'Help the user.', active: true, monthlyTokenLimit: limit,
      });
      agentId = agent.id;
    }
    return database.getRepository(AgentExecution).save({
      agentId, input: 'hello', inputTokens: 1, status: ExecutionStatus.PENDING,
    });
  }

  it('charges once when the same message is processed concurrently and redelivered', async () => {
    const execution = await createExecution();
    await Promise.all([consumer.process(execution.id), consumer.process(execution.id)]);
    await consumer.process(execution.id);
    const row = await database.getRepository(AgentMonthlyUsage).findOneByOrFail({ agentId: execution.agentId });
    expect(row.tokensUsed).toBe(7);
    expect(await database.getRepository(AgentExecution).findOneByOrFail({ id: execution.id }))
      .toMatchObject({ status: ExecutionStatus.COMPLETED, totalTokens: 7 });
  });

  it('allows only one of two queued executions when their combined cost exceeds the quota', async () => {
    const first = await createExecution(undefined, 10);
    const second = await createExecution(first.agentId);
    await Promise.all([consumer.process(first.id), consumer.process(second.id)]);
    const executions = await database.getRepository(AgentExecution).findBy({ agentId: first.agentId });
    expect(executions.map(row => row.status).sort()).toEqual([ExecutionStatus.COMPLETED, ExecutionStatus.FAILED]);
    expect(executions.find(row => row.status === ExecutionStatus.FAILED)?.error).toContain('Monthly token limit exceeded');
    expect(await database.getRepository(AgentMonthlyUsage).findOneByOrFail({ agentId: first.agentId }))
      .toMatchObject({ tokensUsed: 7 });
  });

  it('rolls back token usage when completion fails and safely resumes PROCESSING', async () => {
    const execution = await createExecution();
    await database.query(`CREATE FUNCTION "${schema}".reject_completion() RETURNS trigger AS $$
      BEGIN
        IF NEW.status = 'COMPLETED' THEN RAISE EXCEPTION 'Simulated completion failure'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await database.query(`CREATE TRIGGER reject_completion BEFORE UPDATE ON "${schema}".agent_executions
      FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_completion()`);
    try {
      await expect(consumer.process(execution.id)).rejects.toThrow('Simulated completion failure');
      expect(await database.getRepository(AgentMonthlyUsage).countBy({ agentId: execution.agentId })).toBe(0);
      expect(await database.getRepository(AgentExecution).findOneByOrFail({ id: execution.id }))
        .toMatchObject({ status: ExecutionStatus.PROCESSING, totalTokens: 0 });
    } finally {
      await database.query(`DROP TRIGGER reject_completion ON "${schema}".agent_executions`);
    }
    await consumer.process(execution.id);
    expect(await database.getRepository(AgentMonthlyUsage).findOneByOrFail({ agentId: execution.agentId }))
      .toMatchObject({ tokensUsed: 7 });
    expect(await database.getRepository(AgentExecution).findOneByOrFail({ id: execution.id }))
      .toMatchObject({ status: ExecutionStatus.COMPLETED });
  });
});
