import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app.module.js';
import { ValidationPipe } from '@nestjs/common';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  console.error('Deprecated backend: NestJS build is archived. Use FastAPI in backend/app instead.');
  process.exit(1);
  const app = await NestFactory.create(AppModule, { cors: true });
  app.use('/payments/webhook', bodyParser.raw({ type: 'application/json' }));
  app.use('/api/payments/webhook', bodyParser.raw({ type: 'application/json' }));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`Aigrafka backend listening on :${port}`);
}

bootstrap();
