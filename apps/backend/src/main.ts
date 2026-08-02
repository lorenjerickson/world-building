import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import * as express from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';

async function bootstrap() {
  const httpsEnabled = process.env.API_HTTPS_ENABLED !== 'false';
  const host = process.env.API_HOST || 'local.api.wanderlust-vtt.com';
  const port = Number(process.env.API_PORT || (httpsEnabled ? 8444 : 8000));
  const httpsOptions = httpsEnabled
    ? {
        key: readFileSync(
          process.env.API_HTTPS_KEY_PATH ||
            join(process.cwd(), 'certs', 'local.api.wanderlust-vtt.com-key.pem'),
        ),
        cert: readFileSync(
          process.env.API_HTTPS_CERT_PATH ||
            join(process.cwd(), 'certs', 'local.api.wanderlust-vtt.com.pem'),
        ),
      }
    : undefined;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    httpsOptions,
  });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
  app.use('/uploads', express.static(join(process.cwd(), 'data', 'uploads'), {
    immutable: true,
    maxAge: '1y',
  }));
  
  const corsOrigins = (
    process.env.CORS_ORIGINS || 'https://local.web.wanderlust-vtt.com:8443'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins });
  
  // Enable validation pipe globally
  app.useGlobalPipes(new ValidationPipe());
  
  await app.listen(port, host);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
