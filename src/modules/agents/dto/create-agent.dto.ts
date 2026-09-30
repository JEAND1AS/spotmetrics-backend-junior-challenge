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
} from 'class-validator';

// Remove espaços das pontas antes de validar
const Trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class CreateAgentDto {
  @ApiProperty({ example: 'Support Assistant', minLength: 2, maxLength: 120 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'Responde dúvidas de clientes', maxLength: 500 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: 'Você é um assistente de suporte cordial.' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  systemPrompt: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiProperty({ example: 10000, minimum: 1, description: 'Limite mensal de tokens do agente' })
  @IsInt()
  @Min(1)     
  @Max(100_000_000) 
  monthlyTokenLimit: number;
}