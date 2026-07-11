import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS since the frontend calls this API from port 3000
  app.enableCors();
  
  // Enable validation pipe globally
  app.useGlobalPipes(new ValidationPipe());
  
  await app.listen(8000, '0.0.0.0');
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
