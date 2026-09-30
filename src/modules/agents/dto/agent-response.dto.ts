import { ApiProperty } from '@nestjs/swagger';

export class AgentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Assistente' })
  name: string;

  @ApiProperty({ type: String, nullable: true, example: 'Responde dúvidas de clientes' })
  description: string | null;

  @ApiProperty({ example: 'Você é um assistente de suporte cordial.' })
  systemPrompt: string;

  @ApiProperty({ example: true })
  active: boolean;

  @ApiProperty({ type: 'integer', example: 10000 })
  monthlyTokenLimit: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;

}
