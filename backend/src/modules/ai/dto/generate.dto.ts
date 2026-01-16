import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { BodyMetrics } from '../../../shared/types.js';

export class GenerateDto {
  @IsString()
  @IsNotEmpty()
  productUrl!: string;

  @IsString()
  @IsNotEmpty()
  category!: string;

  metrics!: BodyMetrics;

  @IsOptional()
  @IsString()
  selfieUrl?: string;
}
