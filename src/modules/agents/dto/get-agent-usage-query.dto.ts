import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Length, Matches, ValidateIf } from 'class-validator';

export class GetAgentUsageQueryDto {
  @ApiPropertyOptional({
    example: '2026-09',
    description: 'Mês no formato YYYY-MM. Quando omitido, usa o mês atual em UTC.',
    minLength: 7,
    maxLength: 7,
    pattern: '^\\d{4}-(0[1-9]|1[0-2])$',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(7, 7)
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must use YYYY-MM with a month between 01 and 12' })
  month?: string;
}
