import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AgentsController } from '../modules/agents/agents.controller';
import { AgentsService } from '../modules/agents/agents.service';
import { ExecutionsController } from '../modules/executions/executions.controller';
import { ExecutionsService } from '../modules/executions/executions.service';

// Exercise the HTTP boundary with the same validation settings as main.ts.
// Persistence and messaging are mocked so rejected requests cannot reach them.
describe('Request validation', () => {
  let app: INestApplication;
  let baseUrl: string;
  const agentId = '3b4f8f6e-1c2d-4a5b-9e8f-000000000001';
  const validAgent = { name: 'Bot', systemPrompt: 'Help the user.', monthlyTokenLimit: 100 };
  const agents = {
    create: jest.fn(async (dto) => dto),
    getUsage: jest.fn(async (id, month) => ({ agentId: id, month })),
  };
  const executions = { create: jest.fn(async (_id, dto) => dto) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AgentsController, ExecutionsController],
      providers: [
        { provide: AgentsService, useValue: agents },
        { provide: ExecutionsService, useValue: executions },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => { await app?.close(); });

  async function post(path: string, body: object) {
    const response = await fetch(baseUrl + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  describe('POST /agents', () => {
    it.each([
      ['blank name', { name: ' \t\n ' }],
      ['short trimmed name', { name: ' a ' }],
      ['long name', { name: 'a'.repeat(121) }],
      ['missing name', { name: undefined }],
      ['null name', { name: null }],
      ['non-string name', { name: 123 }],
      ['empty prompt', { systemPrompt: '' }],
      ['blank prompt', { systemPrompt: ' \t\n\u00a0' }],
      ['missing prompt', { systemPrompt: undefined }],
      ['null prompt', { systemPrompt: null }],
      ['non-string prompt', { systemPrompt: {} }],
      ['negative limit', { monthlyTokenLimit: -1 }],
      ['zero limit', { monthlyTokenLimit: 0 }],
      ['fractional limit', { monthlyTokenLimit: 1.5 }],
      ['limit exceeding PostgreSQL integer', { monthlyTokenLimit: 2147483648 }],
      ['numeric string limit', { monthlyTokenLimit: '100' }],
      ['missing limit', { monthlyTokenLimit: undefined }],
      ['null limit', { monthlyTokenLimit: null }],
      ['null active', { active: null }],
      ['string active', { active: 'false' }],
      ['non-string description', { description: 123 }],
      ['unknown field', { unexpected: true }],
    ])('rejects %s before calling the service', async (_label, overrides) => {
      const response = await post('/agents', { ...validAgent, ...overrides });
      expect(response.status).toBe(400);
      expect(Array.isArray(response.body.message)).toBe(true);
      expect(response.body.message.length).toBeGreaterThan(0);
      expect(agents.create).not.toHaveBeenCalled();
    });

    it.each([1, 2147483647])('accepts limit boundary %s and omitted optional fields', async (monthlyTokenLimit) => {
      const response = await post('/agents', { ...validAgent, monthlyTokenLimit });
      expect(response.status).toBe(201);
      expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({ monthlyTokenLimit }));
    });

    it('trims the name while preserving prompt formatting, false and nullable description', async () => {
      const systemPrompt = '  Follow these instructions:\n  - Be helpful.\n';
      const response = await post('/agents', {
        ...validAgent, name: '  Bot  ', systemPrompt, active: false, description: null,
      });
      expect(response.status).toBe(201);
      expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Bot', systemPrompt, active: false, description: null,
      }));
    });

    it('accepts a name at the maximum length', async () => {
      expect((await post('/agents', { ...validAgent, name: 'a'.repeat(120) })).status).toBe(201);
    });
  });

  describe('POST /agents/:id/executions', () => {
    it.each(['', ' \t\n\u00a0', null, undefined, 123, ['hello'], 'a'.repeat(10001)])(
      'rejects invalid input (case %#)', async (input) => {
        const response = await post(`/agents/${agentId}/executions`, { input });
        expect(response.status).toBe(400);
        expect(executions.create).not.toHaveBeenCalled();
      },
    );

    it.each(['x', 'a'.repeat(10000), '  First line\n  Second line\n'])(
      'accepts valid input and preserves formatting (case %#)', async (input) => {
        const response = await post(`/agents/${agentId}/executions`, { input });
        expect(response.status).toBe(201);
        expect(executions.create).toHaveBeenCalledWith(agentId, expect.objectContaining({ input }));
      },
    );
  });

  describe('GET /agents/:id/usage', () => {
    it.each([
      '', '2026-00', '2026-13', '2026-99', '2026-9', '26-09', '2026-09-01',
      'abcd-ef', ' 2026-09', '2026-09\n',
    ])('rejects invalid month %j before calling the service', async (month) => {
      const response = await fetch(`${baseUrl}/agents/${agentId}/usage?month=${encodeURIComponent(month)}`);
      await response.json();
      expect(response.status).toBe(400);
      expect(agents.getUsage).not.toHaveBeenCalled();
    });

    it('rejects repeated month parameters', async () => {
      const response = await fetch(`${baseUrl}/agents/${agentId}/usage?month=2026-01&month=2026-02`);
      await response.json();
      expect(response.status).toBe(400);
      expect(agents.getUsage).not.toHaveBeenCalled();
    });

    it.each(['2026-01', '2026-09', '2026-12'])('accepts month %s', async (month) => {
      const response = await fetch(`${baseUrl}/agents/${agentId}/usage?month=${month}`);
      await response.json();
      expect(response.status).toBe(200);
      expect(agents.getUsage).toHaveBeenCalledWith(agentId, month);
    });

    it('leaves an omitted month undefined so the service uses the current month', async () => {
      const response = await fetch(`${baseUrl}/agents/${agentId}/usage`);
      await response.json();
      expect(response.status).toBe(200);
      expect(agents.getUsage).toHaveBeenCalledWith(agentId, undefined);
    });
  });
});
