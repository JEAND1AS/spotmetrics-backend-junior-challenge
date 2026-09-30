import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotContains,
  ValidateIf,
} from 'class-validator';

// Remove espaços das pontas antes de validar
const Trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class CreateAgentDto {
  @ApiProperty({ example: 'Support Assistant', minLength: 2, maxLength: 120 })
  @Trim()
  @IsString()
  @NotContains('\u0000', { message: '$property must not contain null characters' })
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Responde dúvidas de clientes', maxLength: 500 })
  @IsOptional()
  @Trim()
  @IsString()
  @NotContains('\u0000', { message: '$property must not contain null characters' })
  @MaxLength(500)
  description?: string | null;

  @ApiProperty({ example: 'Você é um assistente de suporte cordial.', minLength: 10 })
  @Trim()
  @IsString()
  @NotContains('\u0000', { message: '$property must not contain null characters' })
  @IsNotEmpty()
  @MinLength(10)
  systemPrompt: string;

  @ApiPropertyOptional({ default: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;

  @ApiProperty({ example: 10000, minimum: 1, maximum: 100_000_000, type: 'integer', description: 'Limite mensal de tokens do agente' })
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  monthlyTokenLimit: number;
}
