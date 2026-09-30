import { ApiProperty } from '@nestjs/swagger';

export class AgentMetricsDto {
  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty({ type: 'integer', minimum: 0, example: 10, description: 'Todas as execuções, incluindo pendentes e em processamento.' })
  totalExecutions: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 7 })
  completedExecutions: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 1 })
  failedExecutions: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 350, description: 'Soma de totalTokens das execuções COMPLETED de todo o histórico.' })
  totalTokens: number;

  @ApiProperty({ minimum: 0, example: 50, description: 'Média de tokens por execução COMPLETED. Zero quando não há concluídas.' })
  averageTokensPerExecution: number;
}
