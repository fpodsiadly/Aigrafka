import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AiServiceResultDto {
  @IsString()
  @IsNotEmpty()
  jobId!: string;

  @IsString()
  @IsNotEmpty()
  imageUrl!: string;

  @IsOptional()
  @IsString()
  fitNote?: string;
}
