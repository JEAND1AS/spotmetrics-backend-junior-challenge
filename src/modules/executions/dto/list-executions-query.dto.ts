import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { ExecutionStatus } from '../execution-status.enum';

// Apenas strings de dígitos: rejeita listas, frações, espaços e notação exponencial.
const QueryInteger = () => Transform(({ value }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value);

export enum ExecutionOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class ListExecutionsQueryDto {
  @ApiPropertyOptional({ type: 'integer', default: 1, minimum: 1, maximum: 2147483647 })
  @QueryInteger()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  page: number = 1;

  @ApiPropertyOptional({ type: 'integer', default: 20, minimum: 1, maximum: 100 })
  @QueryInteger()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ enum: ExecutionStatus })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(ExecutionStatus)
  status?: ExecutionStatus;

  @ApiPropertyOptional({ enum: ExecutionOrder, default: ExecutionOrder.DESC, description: 'Ordenação por createdAt; id desempata datas iguais.' })
  @IsEnum(ExecutionOrder)
  order: ExecutionOrder = ExecutionOrder.DESC;
}
