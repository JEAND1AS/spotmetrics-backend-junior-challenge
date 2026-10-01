import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiOkResponse,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { AgentMetricsDto } from '../agents/dto/agent-metrics.dto';
import { ExecutionPageDto, ExecutionResponseDto } from './dto/execution-response.dto';
import { ListExecutionsQueryDto } from './dto/list-executions-query.dto';
import { CreateExecutionDto } from './dto/create-execution.dto';
import { ExecutionsService } from './executions.service';

@ApiTags('executions')
@Controller()
export class ExecutionsController {
  constructor(private readonly executionsService: ExecutionsService) {}

  @Post('agents/:agentId/executions')
  @ApiOperation({ summary: 'Enfileira uma execução para um agente ativo' })
  @ApiParam({ name: 'agentId', format: 'uuid', description: 'ID do agente que receberá a execução' })
  @ApiCreatedResponse({ type: ExecutionResponseDto, description: 'Publicação confirmada pelo RabbitMQ após validar o saldo para entrada + saída simulada. A execução é criada como PENDING. O worker verifica novamente o saldo atualizado antes de concluir.' })
  @ApiBadRequestResponse({ description: 'agentId inválido ou corpo inválido. Envie um objeto JSON com input obrigatório (1 a 10000 caracteres, contendo texto).' })
  @ApiNotFoundResponse({ description: 'Agente não encontrado.' })
  @ApiConflictResponse({ description: 'Retornado somente quando o agente está inativo (active: false).' })
  @ApiTooManyRequestsResponse({ description: 'Saldo mensal insuficiente para os tokens de entrada + saída simulada. A execução não é criada nem enfileirada; a resposta informa monthlyTokenLimit, tokensUsed e requiredTokens.' })
  @ApiServiceUnavailableResponse({ description: 'Publicação não confirmada (fila indisponível, rejeição ou timeout). A resposta inclui executionId: consulte seu status antes de repetir, pois a mensagem pode ter sido entregue.' })
  create(@Param('agentId', ParseUUIDPipe) agentId: string, @Body() dto: CreateExecutionDto) {
    return this.executionsService.create(agentId, dto);
  }

  @Get('agents/:agentId/executions')
  @ApiOperation({ summary: 'Histórico paginado de execuções do agente', description: 'Inclui agentes inativos. Filtra por status e ordena por createdAt, com id como desempate. Página além do histórico retorna data vazio.' })
  @ApiParam({ name: 'agentId', format: 'uuid' })
  @ApiOkResponse({ type: ExecutionPageDto })
  @ApiBadRequestResponse({ description: 'UUID, paginação, status ou ordenação inválidos.' })
  @ApiNotFoundResponse({ description: 'Agente não encontrado.' })
  findByAgent(@Param('agentId', ParseUUIDPipe) agentId: string, @Query() query: ListExecutionsQueryDto) {
    return this.executionsService.findByAgent(agentId, query);
  }

  @Get('agents/:agentId/metrics')
  @ApiOperation({ summary: 'Métricas de todo o histórico do agente', description: 'Conta todos os status; soma e média de tokens consideram apenas COMPLETED. Agentes sem execuções retornam zeros.' })
  @ApiParam({ name: 'agentId', format: 'uuid' })
  @ApiOkResponse({ type: AgentMetricsDto })
  @ApiBadRequestResponse({ description: 'UUID inválido.' })
  @ApiNotFoundResponse({ description: 'Agente não encontrado.' })
  metrics(@Param('agentId', ParseUUIDPipe) agentId: string) {
    return this.executionsService.getMetrics(agentId);
  }

  @Get('executions/:id')
  @ApiOperation({ summary: 'Consulta os dados e o status de uma execução' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ExecutionResponseDto })
  @ApiBadRequestResponse({ description: 'UUID inválido.' })
  @ApiNotFoundResponse({ description: 'Execução não encontrada.' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.executionsService.findOne(id);
  }
}
