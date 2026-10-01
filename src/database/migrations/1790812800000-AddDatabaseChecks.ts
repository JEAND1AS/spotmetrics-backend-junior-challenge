import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDatabaseChecks1790812800000 implements MigrationInterface {
  name = 'AddDatabaseChecks1790812800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agents"
      ADD CONSTRAINT "chk_agents_monthly_token_limit"
      CHECK ("monthly_token_limit" BETWEEN 1 AND 100000000)
    `);
    await queryRunner.query(`
      ALTER TABLE "agent_executions"
      ADD CONSTRAINT "chk_agent_executions_tokens"
      CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0 AND "total_tokens" >= 0),
      ADD CONSTRAINT "chk_agent_executions_status"
      CHECK ("status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'))
    `);
    await queryRunner.query(`
      ALTER TABLE "agent_monthly_usage"
      ADD CONSTRAINT "chk_agent_monthly_usage_tokens" CHECK ("tokens_used" >= 0),
      ADD CONSTRAINT "chk_agent_monthly_usage_month"
      CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agent_monthly_usage"
      DROP CONSTRAINT "chk_agent_monthly_usage_month",
      DROP CONSTRAINT "chk_agent_monthly_usage_tokens"
    `);
    await queryRunner.query(`
      ALTER TABLE "agent_executions"
      DROP CONSTRAINT "chk_agent_executions_status",
      DROP CONSTRAINT "chk_agent_executions_tokens"
    `);
    await queryRunner.query(`ALTER TABLE "agents" DROP CONSTRAINT "chk_agents_monthly_token_limit"`);
  }
}
