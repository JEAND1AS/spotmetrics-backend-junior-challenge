import { EventEmitter } from 'node:events';
import * as amqp from 'amqplib';
import { RabbitMQService } from './rabbitmq.service';

jest.mock('amqplib', () => ({ connect: jest.fn() }));

describe('RabbitMQ confirmed publication', () => {
  let service: RabbitMQService;
  let channel: EventEmitter & { assertQueue: jest.Mock; sendToQueue: jest.Mock; close: jest.Mock };
  let connection: EventEmitter & { createConfirmChannel: jest.Mock; close: jest.Mock };
  let originalTimeout: string | undefined;

  beforeEach(async () => {
    originalTimeout = process.env.RABBITMQ_PUBLISH_TIMEOUT_MS;
    process.env.RABBITMQ_PUBLISH_TIMEOUT_MS = '100';
    channel = Object.assign(new EventEmitter(), {
      assertQueue: jest.fn().mockResolvedValue({}),
      sendToQueue: jest.fn().mockReturnValue(true),
      close: jest.fn(async () => { channel.emit('close'); }),
    });
    connection = Object.assign(new EventEmitter(), {
      createConfirmChannel: jest.fn().mockResolvedValue(channel),
      close: jest.fn().mockResolvedValue(undefined),
    });
    jest.mocked(amqp.connect).mockResolvedValue(connection as any);
    service = new RabbitMQService();
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.useRealTimers();
    if (originalTimeout === undefined) delete process.env.RABBITMQ_PUBLISH_TIMEOUT_MS;
    else process.env.RABBITMQ_PUBLISH_TIMEOUT_MS = originalTimeout;
    jest.clearAllMocks();
  });

  it('waits for the broker callback, even when sendToQueue returns true', async () => {
    let settled = false;
    const published = service.publish('jobs', { executionId: 'e1' }).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(channel.sendToQueue).toHaveBeenCalledWith('jobs', Buffer.from('{"executionId":"e1"}'),
      expect.objectContaining({ persistent: true, contentType: 'application/json', mandatory: true, messageId: expect.any(String) }),
      expect.any(Function));
    channel.sendToQueue.mock.calls[0][3](null);
    await published;
    expect(settled).toBe(true);
  });

  it('does not mistake buffer backpressure for a negative broker confirmation', async () => {
    channel.sendToQueue.mockReturnValue(false);
    const published = service.publish('jobs', { executionId: 'e1' }, { 'x-retry-count': 1 });
    expect(channel.sendToQueue.mock.calls[0][2].headers).toEqual({ 'x-retry-count': 1 });
    channel.sendToQueue.mock.calls[0][3](null);
    await expect(published).resolves.toBeUndefined();
  });

  it('rejects a broker nack', async () => {
    const published = service.publish('jobs', {});
    const assertion = expect(published).rejects.toThrow('message nacked');
    channel.sendToQueue.mock.calls[0][3](new Error('message nacked'));
    await assertion;
  });

  it('rejects only the unroutable publication among concurrent messages, even if later confirmed', async () => {
    const first = service.publish('missing', {});
    const second = service.publish('jobs', {});
    const assertion = expect(first).rejects.toThrow('could not be routed');
    const [firstCall, secondCall] = channel.sendToQueue.mock.calls;
    expect(firstCall[2].messageId).not.toBe(secondCall[2].messageId);
    channel.emit('return', { properties: { messageId: firstCall[2].messageId } });
    firstCall[3](null);
    secondCall[3](null);
    await assertion;
    await expect(second).resolves.toBeUndefined();
  });

  it('rejects a confirmation timeout and ignores a late callback', async () => {
    jest.useFakeTimers();
    const published = service.publish('jobs', {});
    const assertion = expect(published).rejects.toThrow('timed out');
    await jest.advanceTimersByTimeAsync(100);
    await assertion;
    channel.sendToQueue.mock.calls[0][3](null);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears the timeout when publication succeeds', async () => {
    jest.useFakeTimers();
    const published = service.publish('jobs', {});
    channel.sendToQueue.mock.calls[0][3](null);
    await published;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects pending and future publications when the channel closes', async () => {
    const first = service.publish('jobs', {});
    const second = service.publish('jobs', {});
    const assertions = [expect(first).rejects.toThrow('closed'), expect(second).rejects.toThrow('closed')];
    channel.emit('close');
    await Promise.all(assertions);
    expect(service.isConnected()).toBe(false);
    await expect(service.publish('jobs', {})).rejects.toThrow('unavailable');
  });

  it('closes the connection on shutdown even if the channel was already closed', async () => {
    channel.close.mockRejectedValueOnce(new Error('already closed'));
    await service.onModuleDestroy();
    expect(connection.close).toHaveBeenCalled();
    expect(service.isConnected()).toBe(false);
  });

  it('propagates synchronous send failures without leaking timers', async () => {
    jest.useFakeTimers();
    channel.sendToQueue.mockImplementation(() => { throw new Error('cannot send'); });
    await expect(service.publish('jobs', {})).rejects.toThrow('cannot send');
    expect(jest.getTimerCount()).toBe(0);
  });
});
