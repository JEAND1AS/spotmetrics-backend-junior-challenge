import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiConflictResponse, ApiTags } from '@nestjs/swagger';
import { CreateExecutionDto } from './dto/create-execution.dto';
import { ExecutionsService } from './executions.service';

@ApiTags('executions')
@Controller()
export class ExecutionsController {
  constructor(private readonly executionsService: ExecutionsService) {}

  @Post('agents/:agentId/executions')
  @ApiConflictResponse({ description: 'O agente está inativo e não pode receber novas execuções.' })
  create(@Param('agentId', ParseUUIDPipe) agentId: string, @Body() dto: CreateExecutionDto) {
    return this.executionsService.create(agentId, dto);
  }

  @Get('executions/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.executionsService.findOne(id);
  }
}
