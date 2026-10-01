import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { env } from '../config/env';
import { CreateAgents1740000000000 } from './migrations/1740000000000-CreateAgents';
import { CreateAgentExecutions1740000001000 } from './migrations/1740000001000-CreateAgentExecutions';
import { CreateAgentMonthlyUsage1740000002000 } from './migrations/1740000002000-CreateAgentMonthlyUsage';
import { AddDatabaseChecks1790812800000 } from './migrations/1790812800000-AddDatabaseChecks';

const describeDatabase = process.env.TEST_DATABASE_INTEGRATION === '1' ? describe : describe.skip;

describeDatabase('Database CHECK constraints in PostgreSQL', () => {
  const schema = `checks_test_${randomUUID().replaceAll('-', '')}`;
  const checks = new AddDatabaseChecks1790812800000();
  let database: DataSource;
  let runner: QueryRunner;
  let agentId: string;

  beforeAll(async () => {
    database = new DataSource({ type: 'postgres', ...env.database, synchronize: false });
    await database.initialize();
    runner = database.createQueryRunner();
    await runner.connect();
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET search_path TO "${schema}", public`);
    await new CreateAgents1740000000000().up(runner);
    await new CreateAgentExecutions1740000001000().up(runner);
    await new CreateAgentMonthlyUsage1740000002000().up(runner);
    await checks.up(runner);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      try {
        if (runner?.isTransactionActive) await runner.rollbackTransaction();
        await runner?.release();
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await database.destroy();
      }
    }
  });

  beforeEach(async () => {
    await runner.query('TRUNCATE agent_executions, agent_monthly_usage, agents');
    const [agent] = await runner.query(`
      INSERT INTO agents (name, system_prompt, monthly_token_limit)
      VALUES ('Bot', 'Help the user.', 100) RETURNING id
    `);
    agentId = agent.id;
  });

  async function insert(table: string, column: string, value: string | number) {
    const defaults: Record<string, Record<string, string | number>> = {
      agents: { name: 'Bot', system_prompt: 'Help the user.', monthly_token_limit: 100 },
      agent_executions: { agent_id: agentId, input: 'hello' },
      agent_monthly_usage: { agent_id: agentId, month: '2026-10' },
    };
    const row = { ...defaults[table], [column]: value };
    const columns = Object.keys(row).map(key => `"${key}"`).join(', ');
    const placeholders = Object.keys(row).map((_key, index) => `$${index + 1}`).join(', ');
    return runner.query(`INSERT INTO "${table}" (${columns}) VALUES (${placeholders}) RETURNING id`, Object.values(row));
  }

  const invalidValues = [
    ['agents', 'monthly_token_limit', -1, 'chk_agents_monthly_token_limit'],
    ['agents', 'monthly_token_limit', 0, 'chk_agents_monthly_token_limit'],
    ['agents', 'monthly_token_limit', 100000001, 'chk_agents_monthly_token_limit'],
    ['agent_executions', 'input_tokens', -1, 'chk_agent_executions_tokens'],
    ['agent_executions', 'output_tokens', -1, 'chk_agent_executions_tokens'],
    ['agent_executions', 'total_tokens', -1, 'chk_agent_executions_tokens'],
    ['agent_executions', 'status', 'INVALID', 'chk_agent_executions_status'],
    ['agent_executions', 'status', 'pending', 'chk_agent_executions_status'],
    ['agent_monthly_usage', 'tokens_used', -1, 'chk_agent_monthly_usage_tokens'],
    ...['2026-00', '2026-13', '2026-1', '26-01', '2026/01', 'abcd-01', ''].map(month =>
      ['agent_monthly_usage', 'month', month, 'chk_agent_monthly_usage_month']),
  ] as [string, string, string | number, string][];

  it.each(invalidValues)('rejects invalid %s.%s = %s on INSERT and UPDATE', async (table, column, value, constraint) => {
    await expect(insert(table, column, value)).rejects.toMatchObject({ code: '23514', constraint });
    const validColumn = table === 'agents' ? 'monthly_token_limit' : table === 'agent_executions' ? 'input_tokens' : 'tokens_used';
    const [row] = await insert(table, validColumn, table === 'agents' ? 100 : 0);
    await expect(runner.query(`UPDATE "${table}" SET "${column}" = $1 WHERE id = $2`, [value, row.id]))
      .rejects.toMatchObject({ code: '23514', constraint });
  });

  it.each([
    ['agents', 'monthly_token_limit', 1],
    ['agents', 'monthly_token_limit', 100000000],
    ['agent_executions', 'input_tokens', 0],
    ['agent_executions', 'output_tokens', 0],
    ['agent_executions', 'total_tokens', 0],
    ...['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'].map(status => ['agent_executions', 'status', status]),
    ['agent_monthly_usage', 'tokens_used', 0],
    ['agent_monthly_usage', 'month', '2026-01'],
    ['agent_monthly_usage', 'month', '2026-12'],
  ] as [string, string, string | number][])('accepts valid %s.%s = %s', async (table, column, value) => {
    await expect(insert(table, column, value)).resolves.toEqual([{ id: expect.anything() }]);
  });

  it('reverts checks and rejects existing invalid data when reapplied', async () => {
    await checks.down(runner);
    try {
      await runner.query('UPDATE agents SET monthly_token_limit = 0 WHERE id = $1', [agentId]);
      await runner.startTransaction();
      await expect(checks.up(runner)).rejects.toMatchObject({ code: '23514', constraint: 'chk_agents_monthly_token_limit' });
      await runner.rollbackTransaction();
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.query('UPDATE agents SET monthly_token_limit = 100 WHERE id = $1', [agentId]);
      await checks.up(runner);
    }
    await expect(insert('agents', 'monthly_token_limit', 0))
      .rejects.toMatchObject({ code: '23514', constraint: 'chk_agents_monthly_token_limit' });
  });
});
