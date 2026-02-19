import { Injectable } from '@nestjs/common';
import { GenerateDto } from './dto/generate.dto.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AiQueueService } from './queue.service.js';
import { AiServiceResultDto } from './dto/result.dto';

@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService, private readonly queue: AiQueueService) {}

  async generate(request: GenerateDto) {
    const variants = Math.min(Math.max(request.variants ?? 1, 1), 3);

    const job = await (this.prisma as any).fitJob.create({
      data: {
        userId: request.userId ?? 'anonymous',
        productUrl: request.productUrl,
        category: request.category,
        metrics: { ...request.metrics },
        selfieUrl: request.selfieUrl,
        variants,
        status: 'QUEUED'
      }
    });

    await this.queue.enqueue({
      jobId: job.id,
      userId: job.userId,
      productUrl: job.productUrl,
      category: job.category,
      metrics: job.metrics,
      selfieUrl: job.selfieUrl,
      variants
    });

    return {
      jobId: job.id,
      status: job.status,
      variants,
      message: 'Zlecenie przyjęte do kolejki.'
    };
  }

  async applyResult(body: AiServiceResultDto) {
    const updated = await (this.prisma as any).fitJob.update({
      where: { id: body.jobId },
      data: {
        status: 'SUCCEEDED',
        resultUrl: body.imageUrl,
        fitNote: body.fitNote
      }
    });
    return { jobId: updated.id, status: updated.status, imageUrl: updated.resultUrl, fitNote: updated.fitNote };
  }
}
