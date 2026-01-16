import { buffer } from 'micro';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';

export const config = {
  api: {
    bodyParser: false
  }
};

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2025-12-15.clover'
});

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const rawBody = await buffer(req);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret || '');
  } catch (err: any) {
    console.error('Webhook signature verify failed', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    const amountTotal = session.amount_total ?? 0;
    const tokensToCredit = mapAmountToTokens(amountTotal);

    if (userId && tokensToCredit > 0) {
      await prisma.$transaction([
        prisma.user.upsert({
          where: { id: userId },
          update: { tokens: { increment: tokensToCredit } },
          create: { id: userId, email: `${userId}@placeholder.local`, tokens: tokensToCredit }
        }),
        prisma.tokenTransaction.create({
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

  return res.json({ received: true });
}

function mapAmountToTokens(amountTotal: number) {
  const starterPrice = parseInt(process.env.PRICE_STARTER_CENTS || '1000', 10);
  if (!starterPrice || starterPrice <= 0) return 0;
  const multiplier = amountTotal / starterPrice;
  return Math.round(5 * multiplier);
}
