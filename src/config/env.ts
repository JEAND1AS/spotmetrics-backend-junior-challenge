import 'dotenv/config';

function int(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

export const env = {
  get port() {
    return int('PORT', 3000, 1, 65535);
  },
  get database() {
    return {
      host: process.env.DATABASE_HOST ?? 'localhost',
      port: int('DATABASE_PORT', 5432, 1, 65535),
      username: process.env.DATABASE_USER ?? 'postgres',
      password: process.env.DATABASE_PASSWORD ?? 'postgres',
      database: process.env.DATABASE_NAME ?? 'ai_agents',
    };
  },
  get rabbitmq() {
    return {
      url: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
      executionsQueue: process.env.RABBITMQ_EXECUTIONS_QUEUE ?? 'agent-executions',
      prefetch: int('RABBITMQ_PREFETCH', 5, 1, 65535),
    };
  },
  get processingDelayMs() {
    return int('PROCESSING_DELAY_MS', 2000, 0, 2147483647);
  },
};
