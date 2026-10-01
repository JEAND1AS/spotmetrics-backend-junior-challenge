import { Check, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'agents' })
@Check('chk_agents_monthly_token_limit', '"monthly_token_limit" BETWEEN 1 AND 100000000')
export class Agent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'system_prompt', type: 'text' })
  systemPrompt: string;

  @Column({ default: true })
  active: boolean;

  @Column({ name: 'monthly_token_limit', type: 'integer' })
  monthlyTokenLimit: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
