import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConsumeMessage } from 'amqplib';
import { isUUID } from 'class-validator';
import { Repository } from 'typeorm';
import { Agent } from '../agents/agent.entity';
import { currentMonth } from '../agents/agents.service';
import { RabbitMQService } from '../../common/rabbitmq/rabbitmq.service';
import { AgentExecution } from './agent-execution.entity';
import { ExecutionStatus } from './execution-status.enum';
import { AgentMonthlyUsage } from '../agents/agent-monthly-usage.entity';
import { env } from '../../config/env';
import { countTokens, simulateAgentOutput } from './tokens';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class ExecutionsConsumer implements OnModuleInit {
  private readonly logger = new Logger(ExecutionsConsumer.name);
  private readonly queue = env.rabbitmq.executionsQueue;
  private readonly delayMs = env.processingDelayMs;
  private readonly prefetch = env.rabbitmq.prefetch;
  private readonly maxAttempts = env.rabbitmq.maxAttempts;
  private readonly retryDelayMs = env.rabbitmq.retryDelayMs;
  private readonly failedQueue = `${this.queue}.failed`;
  private consumerTag: string;
  private pausePromise?: Promise<unknown>;

  constructor(
    @InjectRepository(AgentExecution) private readonly executions: Repository<AgentExecution>,
    private readonly rabbit: RabbitMQService,
  ) {}

  async onModuleInit(): Promise<void> {
    const channel = this.rabbit.getChannel();
    await channel.assertQueue(this.queue, { durable: true });
    await channel.assertQueue(this.failedQueue, { durable: true });
    await channel.prefetch(this.prefetch);
    const consumer = await channel.consume(this.queue, (msg) => this.handle(msg).catch((error) => {
      // A closed channel automatically returns unacknowledged deliveries to RabbitMQ.
      this.logger.error('Could not settle RabbitMQ delivery', (error as Error).stack);
    }));
    this.consumerTag = consumer.consumerTag;
    this.logger.log(`Consuming queue "${this.queue}"`);
  }

  private async handle(msg: ConsumeMessage | null): Promise<void> {
    if (!msg) return;
    const channel = this.rabbit.getChannel();
    if (this.pausePromise) {
      await this.pausePromise;
      channel.nack(msg, false, true);
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(msg.content.toString());
    } catch {
      this.logger.warn('Discarding malformed message');
      channel.nack(msg, false, false);
      return;
    }

    if (
      typeof payload !== 'object' || payload === null || Array.isArray(payload) ||
      !('executionId' in payload) || typeof payload.executionId !== 'string' || !isUUID(payload.executionId)
    ) {
      this.logger.warn('Discarding message: executionId must be a valid UUID in a JSON object');
      channel.nack(msg, false, false);
      return;
    }

    const retryHeader = msg.properties?.headers?.['x-retry-count'];
    const retries = retryHeader === undefined ? 0 : retryHeader;
    if (!Number.isInteger(retries) || retries < 0 || retries >= this.maxAttempts) {
      this.logger.warn('Discarding message: invalid x-retry-count');
      channel.nack(msg, false, false);
      return;
    }

    try {
      await this.process(payload.executionId);
    } catch (error) {
      const attempt = retries + 1;
      const exhausted = attempt >= this.maxAttempts;
      const destination = exhausted ? this.failedQueue : this.queue;
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Execution ${payload.executionId} failed on attempt ${attempt}/${this.maxAttempts}: ${reason}`);
      if (!exhausted) await sleep(this.retryDelayMs);
      try {
        await this.rabbit.publish(destination, { executionId: payload.executionId }, {
          'x-retry-count': exhausted ? retries : attempt,
          'x-attempts': attempt,
          'x-last-error': reason.slice(0, 1000),
        });
      } catch (publishError) {
        // Stop consuming before requeueing: no hot loop if the retry/failed queue
        // cannot accept the message. Restart the worker after fixing the broker.
        this.logger.error('Forwarding failed; pausing consumer. Restart worker after recovery.', (publishError as Error).stack);
        this.pausePromise ??= channel.cancel(this.consumerTag);
        await this.pausePromise;
        channel.nack(msg, false, true);
        return;
      }
      if (exhausted) this.logger.error(`Execution ${payload.executionId} moved to ${this.failedQueue}`);
    }
    // Only settle the original after processing or confirmed forwarding.
    channel.ack(msg);
  }

  async process(executionId: string): Promise<void> {
    const existing = await this.executions.findOne({ where: { id: executionId } });
    if (!existing || ![ExecutionStatus.PENDING, ExecutionStatus.PROCESSING].includes(existing.status)) {
      return;
    }

    // Preserve startedAt on redelivery; PROCESSING can be resumed after a crash.
    await this.executions.update({ id: executionId, status: ExecutionStatus.PENDING }, {
      status: ExecutionStatus.PROCESSING, startedAt: new Date(),
    });
    await sleep(this.delayMs);

    await this.executions.manager.transaction(async (manager) => {
      const executions = manager.getRepository(AgentExecution);
      const execution = await executions.findOne({
        where: { id: executionId }, lock: { mode: 'pessimistic_write' },
      });
      if (!execution || execution.status !== ExecutionStatus.PROCESSING) return;

      // Serialize quota checks for this agent, including its first usage row.
      const agent = await manager.getRepository(Agent).findOne({
        where: { id: execution.agentId }, lock: { mode: 'pessimistic_write' },
      });
      if (!agent || !agent.active) {
        execution.status = ExecutionStatus.FAILED;
        execution.error = agent
          ? `Agent ${execution.agentId} is inactive`
          : `Agent ${execution.agentId} not found`;
        execution.completedAt = new Date();
        await executions.save(execution);
        return;
      }

      const output = simulateAgentOutput(agent.name, execution.input);
      const inputTokens = countTokens(execution.input);
      const outputTokens = countTokens(output);
      const totalTokens = inputTokens + outputTokens;
      const completedAt = new Date();
      const month = currentMonth(completedAt);
      const usage = manager.getRepository(AgentMonthlyUsage);
      const row = await usage.findOne({ where: { agentId: agent.id, month } })
        ?? usage.create({ agentId: agent.id, month, tokensUsed: 0 });

      if (row.tokensUsed + totalTokens > agent.monthlyTokenLimit) {
        execution.status = ExecutionStatus.FAILED;
        execution.error = `Monthly token limit exceeded: used ${row.tokensUsed}, required ${totalTokens}, limit ${agent.monthlyTokenLimit}`;
        execution.completedAt = completedAt;
        await executions.save(execution);
        return;
      }

      Object.assign(execution, {
        output, inputTokens, outputTokens, totalTokens,
        status: ExecutionStatus.COMPLETED, error: null, completedAt,
      });
      row.tokensUsed += totalTokens;
      // Both writes commit together. A failure leaves PROCESSING available for retry.
      await usage.save(row);
      await executions.save(execution);
    });
  }
}
