import { IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BodyMetrics } from '../../../shared/types.js';

export class MetricsDto implements BodyMetrics {
  @IsString()
  height!: string;

  @IsString()
  chest!: string;

  @IsString()
  waist!: string;

  @IsString()
  hips!: string;
}

export class GenerateDto {
  @IsString()
  @IsNotEmpty()
  productUrl!: string;

  @IsString()
  @IsNotEmpty()
  category!: string;

  @ValidateNested()
  @Type(() => MetricsDto)
  metrics!: MetricsDto;

  @IsOptional()
  @IsString()
  selfieUrl?: string;

  @IsOptional()
  @IsString()
  userId?: string;
}
