import { ApiProperty } from '@nestjs/swagger';
import { AgentResponseDto } from './agent-response.dto';

export class AgentListItemDto extends AgentResponseDto {
  @ApiProperty({
    type: 'integer', minimum: 0, example: 2500,
    description: 'Tokens contabilizados no mês atual em UTC, incluindo o consumo de hoje.',
  })
  tokensUsedThisMonth: number;

  @ApiProperty({
    type: 'integer', minimum: 0, example: 7500,
    description: 'Saldo do limite mensal após descontar o consumo do mês, com mínimo de zero.',
  })
  tokensRemainingThisMonth: number;

  @ApiProperty({
    type: 'integer', minimum: 0, example: 300,
    description: 'Soma dos tokens de entrada e saída das execuções COMPLETED finalizadas hoje (00:00 até 00:00 do dia seguinte, em UTC).',
  })
  tokensUsedToday: number;
}
