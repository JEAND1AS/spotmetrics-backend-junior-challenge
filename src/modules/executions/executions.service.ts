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
import { countTokens } from './tokens';

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
    const used = await this.getTokensUsed(agentId, currentMonth());
    if (used + inputTokens > agent.monthlyTokenLimit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Monthly token limit exceeded',
          monthlyTokenLimit: agent.monthlyTokenLimit,
          tokensUsed: used,
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
