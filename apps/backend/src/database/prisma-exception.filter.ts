import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

export type PrismaErrorResponse = {
  status: number;
  body: {
    code: string;
    message: string;
    retryable: boolean;
  };
};

export function classifyPrismaError(error: unknown): PrismaErrorResponse {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          body: {
            code: 'DATABASE_UNIQUE_CONFLICT',
            message: 'The requested change conflicts with an existing record.',
            retryable: false,
          },
        };
      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          body: {
            code: 'DATABASE_RELATION_CONFLICT',
            message: 'The requested change conflicts with a related record.',
            retryable: false,
          },
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          body: {
            code: 'DATABASE_RECORD_NOT_FOUND',
            message: 'The requested record was not found.',
            retryable: false,
          },
        };
      case 'P2034':
        return {
          status: HttpStatus.CONFLICT,
          body: {
            code: 'DATABASE_TRANSACTION_CONFLICT',
            message: 'The database transaction conflicted with another write.',
            retryable: true,
          },
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          body: {
            code: 'DATABASE_OPERATION_FAILED',
            message: 'The database operation failed.',
            retryable: false,
          },
        };
    }
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      body: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'The database is temporarily unavailable.',
        retryable: true,
      },
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: {
      code: 'DATABASE_OPERATION_FAILED',
      message: 'The database operation failed.',
      retryable: false,
    },
  };
}

@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientUnknownRequestError,
  Prisma.PrismaClientRustPanicError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const classified = classifyPrismaError(error);
    response.status(classified.status).json(classified.body);
  }
}
