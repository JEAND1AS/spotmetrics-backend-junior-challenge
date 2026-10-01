import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';


const reservedKeys = new Set([
  'prototype',
  ...Object.getOwnPropertyNames(Object.prototype)
])

export class RequestValidationPipe extends ValidationPipe {
  constructor() {
    super({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  }

  async transform(value: unknown, metadata: ArgumentMetadata) {

    if (
  (metadata.type === 'body' || metadata.type === 'query') &&
  value !== null &&
  typeof value === 'object'
) {
  const invalidKey = Object.keys(value)
    .find(key => reservedKeys.has(key));

  if (invalidKey !== undefined) {
    throw new BadRequestException(
      `property ${invalidKey} should not exist`,
    );
  }
}
    if (metadata.type === 'body' &&
        (value === null || typeof value !== 'object' || Array.isArray(value))) {
      throw new BadRequestException('Body must be a JSON object');
    }
    return super.transform(value, metadata);
  }
}
