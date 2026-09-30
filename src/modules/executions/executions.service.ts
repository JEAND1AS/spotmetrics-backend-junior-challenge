import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent } from '../agents/agent.entity';
import { AgentMonthlyUsage } from '../agents/agent-monthly-usage.entity';
import { currentMonth } from '../agents/agents.service';
import { RabbitMQService } from '../../common/rabbitmq/rabbitmq.service';
import { AgentExecution } from './agent-execution.entity';
import { CreateExecutionDto } from './dto/create-execution.dto';
import { ExecutionStatus } from './execution-status.enum';
import { ListExecutionsQueryDto } from './dto/list-executions-query.dto';
import { ExecutionPageDto } from './dto/execution-response.dto';
import { AgentMetricsDto } from '../agents/dto/agent-metrics.dto';
import { countTokens, simulateAgentOutput } from './tokens';

export interface ExecutionMessage {
  executionId: string;
}

@Injectable()
export class ExecutionsService {
  private readonly logger = new Logger(ExecutionsService.name);
  private readonly queue = process.env.RABBITMQ_EXECUTIONS_QUEUE ?? 'agent-executions';

  constructor(
    @InjectRepository(Agent) private readonly agents: Repository<Agent>,
    @InjectRepository(AgentExecution) private readonly executions: Repository<AgentExecution>,
    @InjectRepository(AgentMonthlyUsage) private readonly usage: Repository<AgentMonthlyUsage>,
    private readonly rabbit: RabbitMQService,
  ) {}

  async create(agentId: string, dto: CreateExecutionDto): Promise<AgentExecution> {
    const agent = await this.agents.findOne({ where: { id: agentId } });
    if (!agent) throw new NotFoundException(`Agent ${agentId} not found`);
    if (!agent.active) throw new ConflictException(`Agent ${agentId} is inactive`);

    const inputTokens = countTokens(dto.input);
    const outputTokens = countTokens(simulateAgentOutput(agent.name, dto.input));
    const requiredTokens = inputTokens + outputTokens;
    const used = await this.getTokensUsed(agentId, currentMonth());
    if (used + requiredTokens > agent.monthlyTokenLimit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Monthly token limit exceeded',
          monthlyTokenLimit: agent.monthlyTokenLimit,
          tokensUsed: used,
          requiredTokens,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const execution = await this.executions.save(
      this.executions.create({ agentId, input: dto.input, inputTokens, status: ExecutionStatus.PENDING }),
    );

    try {
      await this.rabbit.publish(this.queue, { executionId: execution.id } satisfies ExecutionMessage);
    } catch (err) {
      // Não deixa uma execução "PENDING" órfã caso a fila esteja fora.
      execution.status = ExecutionStatus.FAILED;
      execution.error = `Failed to enqueue: ${(err as Error).message}`;
      execution.completedAt = new Date();
      await this.executions.save(execution);
      this.logger.error(`Failed to publish execution ${execution.id}`, (err as Error).stack);
      throw new HttpException('Queue unavailable, try again later', HttpStatus.SERVICE_UNAVAILABLE);
    }

    return execution;
  }

  async findByAgent(agentId: string, query: ListExecutionsQueryDto): Promise<ExecutionPageDto> {
    await this.requireAgent(agentId);
    const { page, limit, status, order } = query;
    const [data, total] = await this.executions.findAndCount({
      where: { agentId, ...(status === undefined ? {} : { status }) },
      order: { createdAt: order, id: order },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getMetrics(agentId: string): Promise<AgentMetricsDto> {
    await this.requireAgent(agentId);
    const row = await this.executions.createQueryBuilder('execution')
      .select('COUNT(*)', 'totalExecutions')
      .addSelect('COUNT(*) FILTER (WHERE execution.status = :completed)', 'completedExecutions')
      .addSelect('COUNT(*) FILTER (WHERE execution.status = :failed)', 'failedExecutions')
      .addSelect('COALESCE(SUM(execution.totalTokens) FILTER (WHERE execution.status = :completed), 0)', 'totalTokens')
      .addSelect('COALESCE(AVG(execution.totalTokens) FILTER (WHERE execution.status = :completed), 0)', 'averageTokensPerExecution')
      .where('execution.agentId = :agentId', { agentId })
      .setParameters({ completed: ExecutionStatus.COMPLETED, failed: ExecutionStatus.FAILED })
      .getRawOne();

    // COUNT, SUM e AVG podem ser strings no driver PostgreSQL.
    return {
      agentId,
      totalExecutions: Number(row.totalExecutions),
      completedExecutions: Number(row.completedExecutions),
      failedExecutions: Number(row.failedExecutions),
      totalTokens: Number(row.totalTokens),
      averageTokensPerExecution: Number(row.averageTokensPerExecution),
    };
  }

  private async requireAgent(agentId: string): Promise<void> {
    if (!await this.agents.findOne({ where: { id: agentId } })) {
      throw new NotFoundException(`Agent ${agentId} not found`);
    }
  }

  async findOne(id: string): Promise<AgentExecution> {
    const execution = await this.executions.findOne({ where: { id } });
    if (!execution) throw new NotFoundException(`Execution ${id} not found`);
    return execution;
  }

  async getTokensUsed(agentId: string, month: string): Promise<number> {
    const row = await this.usage.findOne({ where: { agentId, month } });
    return row?.tokensUsed ?? 0;
  }

  async addTokensUsed(agentId: string, month: string, tokens: number): Promise<void> {
    let row = await this.usage.findOne({ where: { agentId, month } });
    if (!row) {
      row = this.usage.create({ agentId, month, tokensUsed: 0 });
    }
    row.tokensUsed += tokens;
    await this.usage.save(row);
  }
}
