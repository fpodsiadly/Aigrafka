import { Module } from '@nestjs/common';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { AiQueueService } from './queue.service.js';

@Module({
  controllers: [AiController],
  providers: [AiService, AiQueueService]
})
export class AiModule {}
