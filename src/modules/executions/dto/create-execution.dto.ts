import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength, NotContains } from 'class-validator';

export class CreateExecutionDto {
  @ApiProperty({
    description: 'Texto enviado ao agente. Use a propriedade input em minúsculas, em um objeto JSON.',
    example: 'Resuma o relatório de vendas do trimestre',
    minLength: 1,
    maxLength: 10000,
    pattern: '\\S',
  })
  @IsString()
  @NotContains('\u0000', { message: 'input must not contain null characters' })
  @MinLength(1)
  @MaxLength(10000)
  @Matches(/\S/, { message: 'input must contain non-whitespace characters' })
  input: string;
}
