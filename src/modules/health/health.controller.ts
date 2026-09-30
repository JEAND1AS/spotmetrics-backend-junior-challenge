import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RabbitMQService } from '../../common/rabbitmq/rabbitmq.service';

class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'degraded'] })
  status: string;

  @ApiProperty({ enum: ['up', 'down'] })
  database: string;

  @ApiProperty({ enum: ['up', 'down'] })
  rabbitmq: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly rabbit: RabbitMQService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Verifica PostgreSQL e RabbitMQ' })
  @ApiOkResponse({ type: HealthResponseDto, description: 'Serviços disponíveis.' })
  @ApiServiceUnavailableResponse({ type: HealthResponseDto, description: 'Um ou mais serviços indisponíveis.' })
  async check() {
    let database = 'up';
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      database = 'down';
    }
    const rabbitmq = this.rabbit.isConnected() ? 'up' : 'down';
    const body = { status: database === 'up' && rabbitmq === 'up' ? 'ok' : 'degraded', database, rabbitmq };
    if (body.status !== 'ok') throw new ServiceUnavailableException(body);
    return body;
  }
}
