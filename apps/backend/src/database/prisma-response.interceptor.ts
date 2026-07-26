import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

export function serializePrismaValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value === null || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }
  if (
    'toJSON' in value
    && typeof (value as { toJSON?: unknown }).toJSON === 'function'
  ) {
    return serializePrismaValue((value as { toJSON: () => unknown }).toJSON(), seen);
  }
  if (seen.has(value)) {
    return seen.get(value);
  }
  if (Array.isArray(value)) {
    const serialized: unknown[] = [];
    seen.set(value, serialized);
    for (const item of value) {
      serialized.push(serializePrismaValue(item, seen));
    }
    return serialized;
  }

  const serialized: Record<string, unknown> = {};
  seen.set(value, serialized);
  for (const [key, item] of Object.entries(value)) {
    serialized[key] = serializePrismaValue(item, seen);
  }
  return serialized;
}

@Injectable()
export class PrismaResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((value) => serializePrismaValue(value)));
  }
}
