import { Body, Controller, Post } from '@nestjs/common';
import { AiService } from './ai.service.js';
import { GenerateDto } from './dto/generate.dto.js';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('generate')
  generate(@Body() body: GenerateDto) {
    return this.aiService.generate(body);
  }
}
