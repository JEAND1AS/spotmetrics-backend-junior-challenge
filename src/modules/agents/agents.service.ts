import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent } from './agent.entity';
import { AgentMonthlyUsage } from './agent-monthly-usage.entity';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { AgentListItemDto } from './dto/agent-list-item.dto';
import { AgentExecution } from '../executions/agent-execution.entity';
import { ExecutionStatus } from '../executions/execution-status.enum';

export function currentMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

@Injectable()
export class AgentsService {
  constructor(
    @InjectRepository(Agent) private readonly agents: Repository<Agent>,
    @InjectRepository(AgentMonthlyUsage) private readonly usage: Repository<AgentMonthlyUsage>,
  ) {}

  create(dto: CreateAgentDto): Promise<Agent> {
    return this.agents.save(this.agents.create({ ...dto, active: dto.active ?? true }));
  }

  async findAll(): Promise<AgentListItemDto[]> {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const { entities, raw } = await this.agents.createQueryBuilder('agent')
      .leftJoin(AgentMonthlyUsage, 'usage', 'usage.agentId = agent.id AND usage.month = :month', {
        month: currentMonth(now),
      })
      .leftJoin((query) => query
        .select('execution.agentId', 'agent_id')
        .addSelect('SUM(execution.totalTokens)', 'tokens_used_today')
        .from(AgentExecution, 'execution')
        .where('execution.status = :completed', { completed: ExecutionStatus.COMPLETED })
        .andWhere('execution.completedAt >= :dayStart AND execution.completedAt < :dayEnd', {
          dayStart,
          dayEnd,
        })
        .groupBy('execution.agentId'), 'daily_usage', 'daily_usage.agent_id = agent.id')
      .addSelect('COALESCE(usage.tokensUsed, 0)', 'tokensUsedThisMonth')
      .addSelect('COALESCE(daily_usage.tokens_used_today, 0)', 'tokensUsedToday')
      .orderBy('agent.createdAt', 'DESC')
      .getRawAndEntities<{
        agent_id: string;
        tokensUsedThisMonth: number | string;
        tokensUsedToday: number | string;
      }>();

    const usageByAgent = new Map(raw.map((row) => [row.agent_id, row]));
    return entities.map((agent) => {
      const usage = usageByAgent.get(agent.id);
      const tokensUsedThisMonth = Number(usage?.tokensUsedThisMonth ?? 0);
      return {
        ...agent,
        tokensUsedThisMonth,
        tokensRemainingThisMonth: Math.max(agent.monthlyTokenLimit - tokensUsedThisMonth, 0),
        tokensUsedToday: Number(usage?.tokensUsedToday ?? 0),
      };
    });
  }

  async findOne(id: string): Promise<Agent> {
    const agent = await this.agents.findOne({ where: { id } });
    if (!agent) throw new NotFoundException(`Agent ${id} not found`);
    return agent;
  }

  async update(id: string, dto: UpdateAgentDto): Promise<Agent> {
    const agent = await this.findOne(id);
    return this.agents.save(Object.assign(agent, dto));
  }

  async deactivate(id: string): Promise<void> {
    const agent = await this.findOne(id);
    if (agent.active) {
      agent.active = false;
      await this.agents.save(agent);
    }
  }

  async getUsage(id: string, month: string = currentMonth()) {
    const agent = await this.findOne(id);
    const row = await this.usage.findOne({ where: { agentId: id, month } });
    const tokensUsed = row?.tokensUsed ?? 0;
    return {
      agentId: agent.id,
      month,
      monthlyTokenLimit: agent.monthlyTokenLimit,
      tokensUsed,
      tokensRemaining: Math.max(agent.monthlyTokenLimit - tokensUsed, 0),
    };
  }
}
