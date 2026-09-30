import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateExecutionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  @Matches(/\S/, { message: 'input must contain non-whitespace characters' })
  input: string;
}
