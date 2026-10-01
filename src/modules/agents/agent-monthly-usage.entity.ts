import { Check, Column, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'agent_monthly_usage' })
@Unique('uq_agent_monthly_usage_agent_month', ['agentId', 'month'])
@Check('chk_agent_monthly_usage_tokens', '"tokens_used" >= 0')
@Check('chk_agent_monthly_usage_month', `"month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`)
export class AgentMonthlyUsage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId: string;

  /** Formato YYYY-MM */
  @Column({ type: 'char', length: 7 })
  month: string;

  @Column({ name: 'tokens_used', type: 'integer', default: 0 })
  tokensUsed: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
