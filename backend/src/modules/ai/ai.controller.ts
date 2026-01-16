import { Body, Controller, Post, Put, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service.js';
import { GenerateDto } from './dto/generate.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AiServiceResultDto } from './dto/result.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('generate')
  @UseGuards(JwtAuthGuard)
  generate(@Body() body: GenerateDto) {
    return this.aiService.generate(body);
  }

  @Put('result')
  updateResult(@Body() body: AiServiceResultDto) {
    return this.aiService.applyResult(body);
  }
}
