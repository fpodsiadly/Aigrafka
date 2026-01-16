import { Injectable } from '@nestjs/common';
import { GenerateDto } from './dto/generate.dto.js';

@Injectable()
export class AiService {
  async generate(request: GenerateDto) {
    // Placeholder: enqueue job to Banana.dev / SD pipeline.
    // In MVP we respond with a mocked image and fit note.
    return {
      message: 'Stylizacja w toku (mock).',
      imageUrl: 'https://placehold.co/320x480?text=Aigrafka+preview',
      fit: {
        size: 'XL',
        recommendation: 'Produkt może być ciasny w klatce piersiowej.'
      },
      request
    };
  }
}
