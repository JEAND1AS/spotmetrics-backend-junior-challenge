import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as amqp from 'amqplib';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';

type Connection = Awaited<ReturnType<typeof amqp.connect>>;

const CONNECT_ATTEMPTS = 15;
const CONNECT_RETRY_DELAY_MS = 2000;

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  private connection: Connection;
  private channel: amqp.ConfirmChannel;
  private connected = false;
  private readonly pending = new Map<string, (error?: Error | null) => void>();

  async onModuleInit(): Promise<void> {
    this.connection = await this.connectWithRetry();
    this.channel = await this.connection.createConfirmChannel();
    this.channel.on('return', (message: amqp.Message) => {
      const messageId = message.properties.messageId;
      this.pending.get(messageId)?.(new Error('Message could not be routed to its queue'));
    });
    this.channel.on('error', (error: Error) => {
      this.logger.error(`rabbitmq channel error: ${error.message}`);
    });
    this.channel.on('close', () => {
      this.connected = false;
      for (const finish of this.pending.values()) finish(new Error('RabbitMQ channel closed before confirmation'));
    });
    await this.channel.assertQueue(env.rabbitmq.executionsQueue, { durable: true });

    this.connection.on('error', (err) => {
      this.logger.error(`rabbitmq connection error: ${err.message}`);
    });
    this.connection.on('close', () => {
      // Simplest recovery strategy: let the process die and the orchestrator restart it.
      this.logger.error('rabbitmq connection closed, shutting down');
      process.exit(1);
    });

    this.connected = true;
    this.logger.log(`connected to rabbitmq (queue=${env.rabbitmq.executionsQueue})`);
  }

  async onModuleDestroy(): Promise<void> {
    this.connected = false;
    this.connection?.removeAllListeners('close');
    try { await this.channel?.close(); } catch { /* already closed */ }
    try { await this.connection?.close(); } catch { /* already closed */ }
  }

  async publish(queue: string, payload: Record<string, unknown>, headers: Record<string, unknown> = {}): Promise<void> {
    if (!this.connected) throw new Error('RabbitMQ channel is unavailable');
    const content = Buffer.from(JSON.stringify(payload));
    const messageId = randomUUID();
    const timeoutMs = env.rabbitmq.publishTimeoutMs;

    return new Promise<void>((resolve, reject) => {
      const finish = (error?: Error | null) => {
        if (!this.pending.delete(messageId)) return;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      const timeout = setTimeout(() => finish(new Error('RabbitMQ publish confirmation timed out')), timeoutMs);
      this.pending.set(messageId, finish);
      try {
        // mandatory detects unroutable messages; the callback is the broker confirm,
        // unlike sendToQueue's boolean return value (local buffer backpressure).
        this.channel.sendToQueue(queue, content, {
          persistent: true, contentType: 'application/json', mandatory: true, messageId, headers,
        }, finish);
      } catch (error) {
        finish(error as Error);
      }
    });
  }

  getChannel(): amqp.Channel {
    return this.channel;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async connectWithRetry(): Promise<Connection> {
    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
      try {
        return await amqp.connect(env.rabbitmq.url);
      } catch (err) {
        this.logger.warn(
          `rabbitmq unavailable (attempt ${attempt}/${CONNECT_ATTEMPTS}): ${(err as Error).message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_DELAY_MS));
      }
    }
    throw new Error('could not connect to rabbitmq');
  }
}
