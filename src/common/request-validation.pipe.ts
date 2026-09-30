import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';

export class RequestValidationPipe extends ValidationPipe {
  constructor() {
    super({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  }

  async transform(value: unknown, metadata: ArgumentMetadata) {
    // Check the raw body before class-transformer can treat an array as a DTO.
    if (metadata.type === 'body' &&
        (value === null || typeof value !== 'object' || Array.isArray(value))) {
      throw new BadRequestException('Body must be a JSON object');
    }
    return super.transform(value, metadata);
  }
}
