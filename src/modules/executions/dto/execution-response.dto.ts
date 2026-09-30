import { ApiProperty } from '@nestjs/swagger';
import { ExecutionStatus } from '../execution-status.enum';

export class ExecutionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty({ example: 'Resuma o relatório de vendas.' })
  input: string;

  @ApiProperty({ type: String, nullable: true })
  output: string | null;

  @ApiProperty({ enum: ExecutionStatus })
  status: ExecutionStatus;

  @ApiProperty({ type: String, nullable: true })
  error: string | null;

  @ApiProperty({ type: 'integer', minimum: 0 })
  inputTokens: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  outputTokens: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  totalTokens: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  startedAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt: Date | null;
}

export class ExecutionPageDto {
  @ApiProperty({ type: [ExecutionResponseDto] })
  data: ExecutionResponseDto[];

  @ApiProperty({ type: 'integer', minimum: 0, description: 'Total de execuções que correspondem ao filtro.' })
  total: number;

  @ApiProperty({ type: 'integer', example: 1 })
  page: number;

  @ApiProperty({ type: 'integer', example: 20 })
  limit: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  totalPages: number;
}
