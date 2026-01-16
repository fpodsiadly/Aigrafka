import { IsIn, IsString } from 'class-validator';

export class CheckoutDto {
  @IsString()
  @IsIn(['starter', 'pro'])
  pack!: 'starter' | 'pro';
}
