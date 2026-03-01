import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service.js';

const priceMap: Record<string, number> = {
  starter: parseInt(process.env.P24_PRICE_STARTER_GROSZE || process.env.PRICE_STARTER_CENTS || '1000', 10),
  pro: parseInt(process.env.P24_PRICE_PRO_GROSZE || '2000', 10)
};

@Injectable()
export class PaymentsService {
  private logger = new Logger(PaymentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createCheckoutSession(pack: string, userId?: string, email?: string) {
    if (process.env.P24_DEMO_MODE === 'true') {
      return { checkoutUrl: 'https://example.com/checkout-demo' };
    }

    const config = this.getP24Config();
    const amount = priceMap[pack] ?? priceMap.starter;
    if (!amount || amount <= 0) {
      throw new Error('Invalid payment amount configuration');
    }

    const currency = process.env.P24_CURRENCY || 'PLN';
    const selectedPack = pack === 'pro' ? 'pro' : 'starter';
    const sessionId = this.buildSessionId(selectedPack, userId);
    const sign = this.sha384(
      JSON.stringify({
        sessionId,
        merchantId: config.merchantId,
        amount,
        currency,
        crc: config.crc
      })
    );

    const payload = {
      merchantId: config.merchantId,
      posId: config.posId,
      sessionId,
      amount,
      currency,
      description: `AIgrafka token pack: ${selectedPack}`,
      email: email || process.env.P24_DEFAULT_CUSTOMER_EMAIL || 'payments@aigrafka.pl',
      country: 'PL',
      language: 'pl',
      urlReturn: process.env.CHECKOUT_SUCCESS_URL || 'https://example.com/success',
      urlStatus: process.env.P24_STATUS_URL || process.env.CHECKOUT_STATUS_URL || 'https://example.com/payments/webhook',
      waitForResult: false,
      sign
    };

    const response = await axios.post(`${config.apiBase}/transaction/register`, payload, {
      auth: {
        username: config.user,
        password: config.secret
      },
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000
    });

    const token = response?.data?.data?.token as string | undefined;
    if (!token) {
      this.logger.error(`P24 transaction/register failed: ${JSON.stringify(response?.data)}`);
      throw new Error('Failed to register Przelewy24 transaction');
    }

    return {
      checkoutUrl: `${config.panelBase}/trnRequest/${token}`,
      provider: 'przelewy24',
      sessionId
    };
  }

  async handleWebhook(rawBody: Buffer | Record<string, unknown>) {
    if (process.env.P24_DEMO_MODE === 'true') {
      return { received: true, demo: true };
    }

    const config = this.getP24Config();
    const payload = this.parseWebhookPayload(rawBody);

    if (!this.isNotificationSignValid(payload, config.crc)) {
      this.logger.error(`Invalid P24 webhook sign for sessionId=${payload.sessionId}`);
      throw new Error('Invalid P24 webhook sign');
    }

    await this.verifyTransaction(payload, config);

    const userId = this.getUserIdFromSessionId(payload.sessionId);
    const amountTotal = payload.amount;
    const tokensToCredit = this.mapAmountToTokens(amountTotal);

    if (userId && tokensToCredit > 0) {
      const externalEventId = `p24:${payload.orderId}`;

      try {
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
              stripeEventId: externalEventId
            }
          })
        ]);
      } catch (error: any) {
        if (error?.code === 'P2002') {
          this.logger.warn(`Duplicate P24 webhook ignored for orderId=${payload.orderId}`);
        } else {
          throw error;
        }
      }
    } else {
      this.logger.warn(`P24 payment confirmed but no user mapping found for sessionId=${payload.sessionId}`);
    }

    return { received: true, provider: 'przelewy24' };
  }

  private async verifyTransaction(
    payload: {
      merchantId: number;
      posId: number;
      sessionId: string;
      amount: number;
      currency: string;
      orderId: number;
    },
    config: {
      merchantId: number;
      posId: number;
      crc: string;
      user: string;
      secret: string;
      apiBase: string;
      panelBase: string;
    }
  ) {
    const verifySign = this.sha384(
      JSON.stringify({
        sessionId: payload.sessionId,
        orderId: payload.orderId,
        amount: payload.amount,
        currency: payload.currency,
        crc: config.crc
      })
    );

    const verifyPayload = {
      merchantId: config.merchantId,
      posId: config.posId,
      sessionId: payload.sessionId,
      amount: payload.amount,
      currency: payload.currency,
      orderId: payload.orderId,
      sign: verifySign
    };

    const verifyResponse = await axios.put(`${config.apiBase}/transaction/verify`, verifyPayload, {
      auth: {
        username: config.user,
        password: config.secret
      },
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000
    });

    const status = verifyResponse?.data?.data?.status;
    if (status !== 'success') {
      this.logger.error(`P24 transaction/verify failed: ${JSON.stringify(verifyResponse?.data)}`);
      throw new Error('P24 transaction verification failed');
    }
  }

  private parseWebhookPayload(rawBody: Buffer | Record<string, unknown>) {
    const parsed =
      Buffer.isBuffer(rawBody)
        ? JSON.parse(rawBody.toString('utf-8'))
        : rawBody;

    if (
      typeof parsed?.sessionId !== 'string' ||
      typeof parsed?.currency !== 'string' ||
      typeof parsed?.sign !== 'string'
    ) {
      throw new Error('Invalid P24 webhook payload');
    }

    return {
      merchantId: Number(parsed.merchantId),
      posId: Number(parsed.posId),
      sessionId: String(parsed.sessionId),
      amount: Number(parsed.amount),
      originAmount: Number(parsed.originAmount),
      currency: String(parsed.currency),
      orderId: Number(parsed.orderId),
      methodId: Number(parsed.methodId),
      statement: typeof parsed.statement === 'string' ? parsed.statement : '',
      sign: String(parsed.sign)
    };
  }

  private isNotificationSignValid(
    payload: {
      merchantId: number;
      posId: number;
      sessionId: string;
      amount: number;
      originAmount: number;
      currency: string;
      orderId: number;
      methodId: number;
      statement: string;
      sign: string;
    },
    crc: string
  ) {
    const expected = this.sha384(
      JSON.stringify({
        merchantId: payload.merchantId,
        posId: payload.posId,
        sessionId: payload.sessionId,
        amount: payload.amount,
        originAmount: payload.originAmount,
        currency: payload.currency,
        orderId: payload.orderId,
        methodId: payload.methodId,
        statement: payload.statement,
        crc
      })
    );

    return expected === payload.sign;
  }

  private getP24Config() {
    const merchantId = parseInt(process.env.P24_MERCHANT_ID || '0', 10);
    const posId = parseInt(process.env.P24_POS_ID || String(merchantId || 0), 10);
    const crc = process.env.P24_CRC || '';
    const user = process.env.P24_API_USER || '';
    const secret = process.env.P24_API_SECRET || '';
    const env = (process.env.P24_ENV || 'sandbox').toLowerCase();
    const apiBase =
      process.env.P24_API_BASE ||
      (env === 'prod' ? 'https://secure.przelewy24.pl/api/v1' : 'https://sandbox.przelewy24.pl/api/v1');
    const panelBase =
      process.env.P24_PANEL_BASE ||
      (env === 'prod' ? 'https://secure.przelewy24.pl' : 'https://sandbox.przelewy24.pl');

    if (!merchantId || !posId || !crc || !user || !secret) {
      throw new Error('Missing Przelewy24 config: P24_MERCHANT_ID, P24_POS_ID, P24_CRC, P24_API_USER, P24_API_SECRET');
    }

    return {
      merchantId,
      posId,
      crc,
      user,
      secret,
      apiBase,
      panelBase
    };
  }

  private buildSessionId(pack: string, userId?: string) {
    const safeUser = userId ? userId.replace(/[^a-zA-Z0-9_-]/g, '') : 'guest';
    const base = `aigrafka:${safeUser}:${pack}:${Date.now()}:${randomUUID().slice(0, 8)}`;
    return base.slice(0, 100);
  }

  private getUserIdFromSessionId(sessionId: string): string | undefined {
    const parts = sessionId.split(':');
    if (parts.length < 3) return undefined;
    const user = parts[1];
    if (!user || user === 'guest') return undefined;
    return user;
  }

  private sha384(input: string) {
    return createHash('sha384').update(input, 'utf-8').digest('hex');
  }

  private mapAmountToTokens(amountTotal: number) {
    const starterPrice = parseInt(process.env.PRICE_STARTER_CENTS || '1000', 10);
    if (!starterPrice || starterPrice <= 0) return 0;
    const multiplier = amountTotal / starterPrice;
    return Math.round(5 * multiplier);
  }
}
