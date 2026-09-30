import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import 'reflect-metadata';
import { env } from './config/env';
import { RequestValidationPipe } from './common/request-validation.pipe';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const port = env.port;
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new RequestValidationPipe());
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('AI Agents Platform')
    .setDescription('API de gerenciamento e execução assíncrona de agentes de IA')
    .setVersion('0.3.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port} (docs em /docs)`, 'Bootstrap');
}

bootstrap();
