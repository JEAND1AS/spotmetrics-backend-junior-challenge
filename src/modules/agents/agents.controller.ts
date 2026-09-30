import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { GetAgentUsageQueryDto } from './dto/get-agent-usage-query.dto';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um agente' })
  create(@Body() dto: CreateAgentDto) {
    return this.agentsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista agentes' })
  findAll() {
    return this.agentsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca agente por id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.agentsService.findOne(id);
  }

  @Get(':id/usage')
  @ApiOperation({ summary: 'Consumo de tokens do agente no mês' })
  usage(@Param('id', ParseUUIDPipe) id: string, @Query() query: GetAgentUsageQueryDto) {
    return this.agentsService.getUsage(id, query.month);
  }
}
