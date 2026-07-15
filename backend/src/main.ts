import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
  app.use('/uploads', express.static(join(process.cwd(), 'data', 'uploads'), {
    immutable: true,
    maxAge: '1y',
  }));
  
  // Enable CORS since the frontend calls this API from port 3000
  app.enableCors();
  
  // Enable validation pipe globally
  app.useGlobalPipes(new ValidationPipe());
  
  await app.listen(8000, '0.0.0.0');
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
