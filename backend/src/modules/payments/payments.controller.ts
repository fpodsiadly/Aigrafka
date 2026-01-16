import { Body, Controller, Post } from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { CheckoutDto } from './dto/checkout.dto.js';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('checkout')
  createCheckout(@Body() body: CheckoutDto) {
    return this.paymentsService.createCheckoutSession(body.pack);
  }
}
