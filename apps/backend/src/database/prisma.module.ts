import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaExceptionFilter } from './prisma-exception.filter';
import { PrismaResponseInterceptor } from './prisma-response.interceptor';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [
    PrismaService,
    {
      provide: APP_FILTER,
      useClass: PrismaExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: PrismaResponseInterceptor,
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
