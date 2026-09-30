import { ApiProperty } from '@nestjs/swagger';

export class AgentUsageDto {
  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty({ example: '2026-09', description: 'Mês de referência em UTC (YYYY-MM).' })
  month: string;

  @ApiProperty({ type: 'integer', example: 10000 })
  monthlyTokenLimit: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 2500 })
  tokensUsed: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 7500 })
  tokensRemaining: number;
}
