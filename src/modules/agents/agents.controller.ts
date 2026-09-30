import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCreatedResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AgentResponseDto } from './dto/agent-response.dto';
import { AgentUsageDto } from './dto/agent-usage.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { AgentListItemDto } from './dto/agent-list-item.dto';
import { GetAgentUsageQueryDto } from './dto/get-agent-usage-query.dto';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um agente' })
  @ApiCreatedResponse({ type: AgentResponseDto, description: 'Agente criado.' })
  @ApiBadRequestResponse({ description: 'Corpo inválido ou campos desconhecidos.' })
  create(@Body() dto: CreateAgentDto) {
    return this.agentsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista agentes com consumo mensal e diário de tokens (UTC)' })
  @ApiOkResponse({ type: AgentListItemDto, isArray: true })
  findAll() {
    return this.agentsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca agente por id' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AgentResponseDto })
  @ApiBadRequestResponse({ description: 'UUID inválido.' })
  @ApiNotFoundResponse({ description: 'Agente não encontrado.' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.agentsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza parcialmente um agente', description: 'Campos omitidos são preservados. description aceita null para limpar o valor; active: true reativa o agente. Um objeto vazio mantém os dados atuais.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AgentResponseDto })
  @ApiBadRequestResponse({ description: 'UUID ou corpo inválido.' })
  @ApiNotFoundResponse({ description: 'Agente não encontrado.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAgentDto) {
    return this.agentsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Desativa um agente', description: 'Define active: false e preserva o histórico e o consumo. Repetir a operação retorna 204. Novas execuções são recusadas com 409.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Agente desativado, sem corpo de resposta.' })
  @ApiBadRequestResponse({ description: 'UUID inválido.' })
  @ApiNotFoundResponse({ description: 'Agente não encontrado.' })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.agentsService.deactivate(id);
  }

  @Get(':id/usage')
  @ApiOperation({ summary: 'Consumo de tokens do agente no mês' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AgentUsageDto })
  @ApiBadRequestResponse({ description: 'UUID ou mês inválido. Use YYYY-MM.' })
  @ApiNotFoundResponse({ description: 'Agente não encontrado.' })
  usage(@Param('id', ParseUUIDPipe) id: string, @Query() query: GetAgentUsageQueryDto) {
    return this.agentsService.getUsage(id, query.month);
  }
}
