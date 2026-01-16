import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class AiQueueService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly queueKey = 'aigrafka:ai:jobs';

  constructor() {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    this.redis = new Redis(url);
  }

  async enqueue(job: Record<string, unknown>) {
    await this.redis.lpush(this.queueKey, JSON.stringify(job));
    return { enqueued: true };
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
