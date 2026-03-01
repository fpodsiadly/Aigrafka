import { buffer } from 'micro';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import axios from 'axios';

export const config = {
  api: {
    bodyParser: false
  }
};

const prisma = new PrismaClient();

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const rawBody = await buffer(req);
    const payload = JSON.parse(rawBody.toString('utf-8'));
    const config = getP24Config();

    if (!isNotificationSignValid(payload, config.crc)) {
      return res.status(400).json({ error: 'Invalid P24 sign' });
    }

    const verifySign = sha384(
      JSON.stringify({
        sessionId: payload.sessionId,
        orderId: Number(payload.orderId),
        amount: Number(payload.amount),
        currency: String(payload.currency),
        crc: config.crc
      })
    );

    const verifyResponse = await axios.put(
      `${config.apiBase}/transaction/verify`,
      {
        merchantId: config.merchantId,
        posId: config.posId,
        sessionId: String(payload.sessionId),
        amount: Number(payload.amount),
        currency: String(payload.currency),
        orderId: Number(payload.orderId),
        sign: verifySign
      },
      {
        auth: {
          username: config.user,
          password: config.secret
        },
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      }
    );

    if (verifyResponse?.data?.data?.status !== 'success') {
      return res.status(400).json({ error: 'P24 verify failed', details: verifyResponse?.data });
    }

    const userId = getUserIdFromSessionId(String(payload.sessionId));
    const tokensToCredit = mapAmountToTokens(Number(payload.amount));

    if (userId && tokensToCredit > 0) {
      const externalEventId = `p24:${Number(payload.orderId)}`;

      try {
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
              stripeEventId: externalEventId
            }
          })
        ]);
      } catch (error: any) {
        if (error?.code !== 'P2002') {
          throw error;
        }
      }
    }
  } catch (err: any) {
    console.error('P24 webhook error', err?.message || err);
    return res.status(400).json({ error: err?.message || 'Webhook error' });
  }

  return res.json({ received: true, provider: 'przelewy24' });
}

function mapAmountToTokens(amountTotal: number) {
  const starterPrice = parseInt(process.env.PRICE_STARTER_CENTS || '1000', 10);
  if (!starterPrice || starterPrice <= 0) return 0;
  const multiplier = amountTotal / starterPrice;
  return Math.round(5 * multiplier);
}

function getP24Config() {
  const merchantId = parseInt(process.env.P24_MERCHANT_ID || '0', 10);
  const posId = parseInt(process.env.P24_POS_ID || String(merchantId || 0), 10);
  const crc = process.env.P24_CRC || '';
  const user = process.env.P24_API_USER || '';
  const secret = process.env.P24_API_SECRET || '';
  const env = (process.env.P24_ENV || 'sandbox').toLowerCase();

  const apiBase =
    process.env.P24_API_BASE ||
    (env === 'prod' ? 'https://secure.przelewy24.pl/api/v1' : 'https://sandbox.przelewy24.pl/api/v1');

  if (!merchantId || !posId || !crc || !user || !secret) {
    throw new Error('Missing Przelewy24 config (P24_MERCHANT_ID, P24_POS_ID, P24_CRC, P24_API_USER, P24_API_SECRET)');
  }

  return { merchantId, posId, crc, user, secret, apiBase };
}

function sha384(input: string) {
  return createHash('sha384').update(input, 'utf-8').digest('hex');
}

function isNotificationSignValid(payload: any, crc: string) {
  const expected = sha384(
    JSON.stringify({
      merchantId: Number(payload.merchantId),
      posId: Number(payload.posId),
      sessionId: String(payload.sessionId || ''),
      amount: Number(payload.amount || 0),
      originAmount: Number(payload.originAmount || 0),
      currency: String(payload.currency || ''),
      orderId: Number(payload.orderId || 0),
      methodId: Number(payload.methodId || 0),
      statement: String(payload.statement || ''),
      crc
    })
  );

  return expected === String(payload.sign || '');
}

function getUserIdFromSessionId(sessionId: string): string | undefined {
  const parts = sessionId.split(':');
  if (parts.length < 3) return undefined;
  const user = parts[1];
  if (!user || user === 'guest') return undefined;
  return user;
}
