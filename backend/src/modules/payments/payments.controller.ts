import { Body, Controller, Post, Req } from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { CheckoutDto } from './dto/checkout.dto.js';
import { Request } from 'express';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('checkout')
  createCheckout(@Body() body: CheckoutDto) {
    return this.paymentsService.createCheckoutSession(body.pack, body.userId, body.email);
  }

  @Post('webhook')
  async handleWebhook(@Req() req: Request) {
    const rawBody: Buffer = (req as any).rawBody || (req as any).body;
    return this.paymentsService.handleWebhook(rawBody);
  }
}
