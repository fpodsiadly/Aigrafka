import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service.js';

const priceMap: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_STARTER || 'price_starter_placeholder',
  pro: process.env.STRIPE_PRICE_PRO || 'price_pro_placeholder'
};

@Injectable()
export class PaymentsService {
  private stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
    apiVersion: '2024-06-20'
  });
  private logger = new Logger(PaymentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createCheckoutSession(pack: string, userId?: string) {
    const priceId = priceMap[pack] ?? priceMap.starter;
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      success_url: process.env.CHECKOUT_SUCCESS_URL || 'https://example.com/success',
      cancel_url: process.env.CHECKOUT_CANCEL_URL || 'https://example.com/cancel',
      metadata: userId ? { userId } : undefined
    });

    return { checkoutUrl: session.url };
  }

  async handleWebhook(rawBody: Buffer, signature: string | undefined) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('Missing STRIPE_WEBHOOK_SECRET');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature || '', webhookSecret);
    } catch (err) {
      this.logger.error(`Webhook signature verification failed: ${err}`);
      throw err;
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const amountTotal = session.amount_total ?? 0;
      const tokensToCredit = this.mapAmountToTokens(amountTotal);

      if (userId && tokensToCredit > 0) {
        await this.prisma.$transaction([
          this.prisma.user.upsert({
            where: { id: userId },
            update: { tokens: { increment: tokensToCredit } },
            create: { id: userId, email: `${userId}@placeholder.local`, tokens: tokensToCredit }
          }),
          this.prisma.tokenTransaction.create({
            data: {
              userId,
              amount: tokensToCredit,
              type: 'PURCHASE',
              status: 'SUCCEEDED',
              stripeEventId: event.id
            }
          })
        ]);
      }
    }

    return { received: true };
  }

  private mapAmountToTokens(amountTotal: number) {
    // Simple mapping: assumes price is in cents; grant 5 tokens per starter price baseline.
    const starterPrice = parseInt(process.env.PRICE_STARTER_CENTS || '1000', 10);
    if (!starterPrice || starterPrice <= 0) return 0;
    const multiplier = amountTotal / starterPrice;
    return Math.round(5 * multiplier);
  }
}
