import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpsertProfileDto {
  @IsString()
  userId!: string;

  @IsString()
  height!: string;

  @IsString()
  chest!: string;

  @IsString()
  waist!: string;

  @IsString()
  hips!: string;

  @IsOptional()
  @IsString()
  fitStyle?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  productUrl?: string;

  @IsOptional()
  @IsString()
  selfieUrl?: string;

  @IsBoolean()
  consentGiven!: boolean;
}
