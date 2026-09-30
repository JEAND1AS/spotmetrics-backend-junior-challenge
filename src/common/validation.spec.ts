import { INestApplication, NotFoundException } from '@nestjs/common';
import { RequestValidationPipe } from './request-validation.pipe';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SchemaObject, SwaggerModule } from '@nestjs/swagger';
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
    findAll: jest.fn(),
    update: jest.fn(async (id, dto) => ({ id, ...dto })),
    deactivate: jest.fn(),
    create: jest.fn(async (dto) => dto),
    getUsage: jest.fn(async (id, month) => ({ agentId: id, month })),
  };
  const executions = {
    create: jest.fn(async (_id, dto) => dto),
    findByAgent: jest.fn(async (_id, query) => ({ data: [], total: 0, ...query, totalPages: 0 })),
    getMetrics: jest.fn(async (agentId) => ({ agentId, totalExecutions: 0, completedExecutions: 0, failedExecutions: 0, totalTokens: 0, averageTokensPerExecution: 0 })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AgentsController, ExecutionsController],
      providers: [
        { provide: AgentsService, useValue: agents },
        { provide: ExecutionsService, useValue: executions },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new RequestValidationPipe());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => { await app?.close(); });

  async function post(path: string, body: unknown) {
    const response = await fetch(baseUrl + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  describe('GET /agents', () => {
    it('returns the list with numeric usage fields and documents them in Swagger', async () => {
      const result = [{
        id: agentId, ...validAgent, active: true,
        tokensUsedThisMonth: 30, tokensRemainingThisMonth: 70, tokensUsedToday: 10,
      }];
      agents.findAll.mockResolvedValueOnce(result);
      const response = await fetch(baseUrl + '/agents');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(result);

      const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
      expect(document.paths['/agents'].get!.responses['200']).toMatchObject({
        content: { 'application/json': { schema: {
          type: 'array', items: { $ref: '#/components/schemas/AgentListItemDto' },
        } } },
      });
      const schema = document.components!.schemas!.AgentListItemDto as SchemaObject;
      for (const field of ['tokensUsedThisMonth', 'tokensRemainingThisMonth', 'tokensUsedToday']) {
        expect(schema.properties![field]).toMatchObject({ type: 'integer', minimum: 0 });
        expect(schema.required).toContain(field);
      }
    });
  });

  describe('POST /agents', () => {
    it.each([
      ['NUL name', { name: 'Bot\u0000' }],
      ['NUL prompt', { systemPrompt: 'Help the user.\u0000' }],
      ['NUL description', { description: 'hello\u0000world' }],
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
      ['limit exceeding business maximum', { monthlyTokenLimit: 100_000_001 }],
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

    it.each([1, 100_000_000])('accepts limit boundary %s and omitted optional fields', async (monthlyTokenLimit) => {
      const response = await post('/agents', { ...validAgent, monthlyTokenLimit });
      expect(response.status).toBe(201);
      expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({ monthlyTokenLimit }));
    });

    it('trims name and prompt edges while preserving inner formatting, false and nullable description', async () => {
      const systemPrompt = '  Follow these instructions:\n  - Be helpful.\n';
      const response = await post('/agents', {
        ...validAgent, name: '  Bot  ', systemPrompt, active: false, description: null,
      });
      expect(response.status).toBe(201);
      expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Bot', systemPrompt: systemPrompt.trim(), active: false, description: null,
      }));
    });

    it('accepts a name at the maximum length', async () => {
      expect((await post('/agents', { ...validAgent, name: 'a'.repeat(120) })).status).toBe(201);
    });
  });

  describe('POST /agents/:id/executions', () => {
    it('documents the required input and provides an example accepted by the HTTP endpoint', async () => {
      const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
      const operation = document.paths['/agents/{agentId}/executions'].post!;
      expect(operation.requestBody).toMatchObject({
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateExecutionDto' } } },
      });
      const schema = document.components!.schemas!.CreateExecutionDto as SchemaObject;
      expect(schema).toMatchObject({
        type: 'object',
        required: ['input'],
        properties: { input: { type: 'string', minLength: 1, maxLength: 10000, pattern: '\\S' } },
      });
      const input = (schema.properties!.input as SchemaObject).example;
      expect(typeof input).toBe('string');
      expect((await post(`/agents/${agentId}/executions`, { input })).status).toBe(201);
      expect(executions.create).toHaveBeenCalledWith(agentId, expect.objectContaining({ input }));
      expect(Object.keys(operation.responses)).toEqual(['201', '400', '404', '409', '429', '503']);
    });

    it.each([
      ['uppercase Input', { Input: 'Resuma a api do cliente X e Y' }],
      ['JSON encoded as a string', JSON.stringify({ input: 'Resuma a api do cliente X e Y' })],
    ])('rejects %s before calling the service', async (_label, body) => {
      expect((await post(`/agents/${agentId}/executions`, body)).status).toBe(400);
      expect(executions.create).not.toHaveBeenCalled();
    });

    it.each(['hello\u0000world', '', ' \t\n\u00a0', null, undefined, 123, ['hello'], 'a'.repeat(10001)])(
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

  describe('PATCH /agents/:id', () => {
    async function patch(body: unknown, id = agentId) {
      const response = await fetch(`${baseUrl}/agents/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }

    it.each([{ name: '  New name  ' }, { active: false }, { active: true }, { description: null }, {}])(
      'accepts partial updates %j', async (body) => {
        expect((await patch(body)).status).toBe(200);
        expect(agents.update).toHaveBeenCalledWith(agentId, expect.objectContaining(
          'name' in body ? { name: 'New name' } : body,
        ));
        const dto = agents.update.mock.calls[0][1];
        for (const field of ['name', 'systemPrompt', 'monthlyTokenLimit', 'active', 'description']) {
          if (!(field in body)) expect(dto[field]).toBeUndefined();
        }
      },
    );

    it.each([
      { name: 'Bot\u0000' }, { systemPrompt: 'Help the user.\u0000' }, { description: 'a\u0000' },
      { name: null }, { systemPrompt: null }, { monthlyTokenLimit: null }, { active: null },
      { name: ' ' }, { systemPrompt: ' ' }, { name: 'a'.repeat(121) },
      { monthlyTokenLimit: 0 }, { monthlyTokenLimit: 1.5 }, { monthlyTokenLimit: 100_000_001 },
      { active: 'false' }, { description: 'a'.repeat(501) }, { id: agentId },
    ])('rejects invalid partial update %j', async (body) => {
      expect((await patch(body)).status).toBe(400);
      expect(agents.update).not.toHaveBeenCalled();
    });

    it.each([[], [{ active: false }], null, 'text', 1, false].map(body => [body]))('rejects non-object bodies %j', async (body) => {
      expect((await patch(body)).status).toBe(400);
      expect(agents.update).not.toHaveBeenCalled();
    });

    it('rejects invalid UUIDs', async () => {
      expect((await patch({ name: 'New name' }, 'invalid')).status).toBe(400);
      expect(agents.update).not.toHaveBeenCalled();
    });

    it('returns 404 for unknown agents', async () => {
      agents.update.mockRejectedValueOnce(new NotFoundException());
      expect((await patch({ name: 'New name' })).status).toBe(404);
    });
  });

  describe('DELETE /agents/:id', () => {
    it('returns 204 with no body', async () => {
      const response = await fetch(`${baseUrl}/agents/${agentId}`, { method: 'DELETE' });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
      expect(agents.deactivate).toHaveBeenCalledWith(agentId);
    });

    it('returns 404 for unknown agents', async () => {
      agents.deactivate.mockRejectedValueOnce(new NotFoundException());
      const response = await fetch(`${baseUrl}/agents/${agentId}`, { method: 'DELETE' });
      expect(response.status).toBe(404);
      await response.json();
    });

    it('rejects invalid UUIDs before calling the service', async () => {
      const response = await fetch(`${baseUrl}/agents/invalid`, { method: 'DELETE' });
      expect(response.status).toBe(400);
      await response.json();
      expect(agents.deactivate).not.toHaveBeenCalled();
    });
  });

  describe('GET /agents/:id/executions', () => {
    it.each([
      ['', { page: 1, limit: 20, order: 'DESC' }],
      ['?page=2&limit=5&status=FAILED&order=ASC', { page: 2, limit: 5, status: 'FAILED', order: 'ASC' }],
    ])('validates and converts query parameters %s', async (query, expected) => {
      const response = await fetch(`${baseUrl}/agents/${agentId}/executions${query}`);
      expect(response.status).toBe(200);
      await response.json();
      expect(executions.findByAgent).toHaveBeenCalledWith(agentId, expect.objectContaining(expected));
    });

    it.each([
      'page=0', 'page=-1', 'page=1.5', 'page=abc', 'page=', 'page=1e2', 'page=2147483648',
      'limit=0', 'limit=101', 'limit=1.5', 'page=1&page=2', 'limit=1&limit=2',
      'status=completed', 'status=UNKNOWN', 'order=desc', 'order=INVALID', 'unknown=true',
    ])('rejects invalid query %s', async (query) => {
      const response = await fetch(`${baseUrl}/agents/${agentId}/executions?${query}`);
      expect(response.status).toBe(400);
      await response.json();
      expect(executions.findByAgent).not.toHaveBeenCalled();
    });
  });

  describe('agent history and metrics errors', () => {
    it.each(['executions', 'metrics'])('rejects invalid UUID for %s', async (route) => {
      const response = await fetch(`${baseUrl}/agents/invalid/${route}`);
      expect(response.status).toBe(400);
      await response.json();
      expect(executions.findByAgent).not.toHaveBeenCalled();
      expect(executions.getMetrics).not.toHaveBeenCalled();
    });

    it.each(['executions', 'metrics'])('returns 404 for an unknown agent on %s', async (route) => {
      const method = route === 'executions' ? executions.findByAgent : executions.getMetrics;
      method.mockRejectedValueOnce(new NotFoundException());
      const response = await fetch(`${baseUrl}/agents/${agentId}/${route}`);
      expect(response.status).toBe(404);
      await response.json();
    });

    it('returns the metrics response', async () => {
      const response = await fetch(`${baseUrl}/agents/${agentId}/metrics`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        agentId, totalExecutions: 0, completedExecutions: 0, failedExecutions: 0,
        totalTokens: 0, averageTokensPerExecution: 0,
      });
    });
  });

  it('documents the new routes, request fields and response schemas', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    const patch = document.paths['/agents/{id}'].patch!;
    expect(patch.requestBody).toMatchObject({ content: {
      'application/json': { schema: { $ref: '#/components/schemas/UpdateAgentDto' } },
    } });
    const update = document.components!.schemas!.UpdateAgentDto as SchemaObject;
    expect(update.required ?? []).toEqual([]);
    expect(update.properties!.monthlyTokenLimit).toMatchObject({ minimum: 1, maximum: 100_000_000 });
    expect(document.paths['/agents/{id}'].delete!.responses['204']).not.toHaveProperty('content');
    const history = document.paths['/agents/{agentId}/executions'].get!;
    expect(history.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'page', in: 'query', required: false }),
      expect.objectContaining({ name: 'limit', in: 'query', required: false }),
      expect.objectContaining({ name: 'status', in: 'query', required: false }),
      expect.objectContaining({ name: 'order', in: 'query', required: false }),
    ]));
    expect(history.responses['200']).toMatchObject({ content: {
      'application/json': { schema: { $ref: '#/components/schemas/ExecutionPageDto' } },
    } });
    expect(document.paths['/agents/{agentId}/metrics'].get!.responses['200']).toMatchObject({ content: {
      'application/json': { schema: { $ref: '#/components/schemas/AgentMetricsDto' } },
    } });
    for (const operation of [patch, history, document.paths['/agents/{agentId}/metrics'].get!]) {
      expect(operation.responses).toHaveProperty('400');
      expect(operation.responses).toHaveProperty('404');
    }
  });

});
