import { env } from './env';

const settings = [
  ['PORT', () => env.port, 3000, 1, 65535],
  ['DATABASE_PORT', () => env.database.port, 5432, 1, 65535],
  ['RABBITMQ_PREFETCH', () => env.rabbitmq.prefetch, 5, 1, 65535],
  ['RABBITMQ_PUBLISH_TIMEOUT_MS', () => env.rabbitmq.publishTimeoutMs, 5000, 1, 2147483647],
  ['RABBITMQ_MAX_ATTEMPTS', () => env.rabbitmq.maxAttempts, 3, 1, 100],
  ['RABBITMQ_RETRY_DELAY_MS', () => env.rabbitmq.retryDelayMs, 1000, 1, 2147483647],
  ['PROCESSING_DELAY_MS', () => env.processingDelayMs, 2000, 0, 2147483647],
] as const;

describe.each(settings)('%s', (name, read, fallback, min, max) => {
  let original: string | undefined;
  beforeEach(() => { original = process.env[name]; delete process.env[name]; });
  afterEach(() => {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  });

  it('uses the default only when omitted', () => expect(read()).toBe(fallback));
  it.each(['', ' ', 'abc', '5432abc', '1.5', '1e2', '-1', 'NaN', 'Infinity', '9007199254740993', '5\n'])(
    'rejects malformed value %j', (value) => {
      process.env[name] = value;
      expect(read).toThrow(name);
    },
  );
  it('enforces both bounds', () => {
    for (const value of [min, max]) {
      process.env[name] = String(value);
      expect(read()).toBe(value);
    }
    for (const value of [min - 1, max + 1]) {
      process.env[name] = String(value);
      expect(read).toThrow(name);
    }
  });
});
