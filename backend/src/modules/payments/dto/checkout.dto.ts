import { IsIn, IsOptional, IsString } from 'class-validator';

export class CheckoutDto {
  @IsString()
  @IsIn(['starter', 'pro'])
  pack!: 'starter' | 'pro';

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  email?: string;
}
