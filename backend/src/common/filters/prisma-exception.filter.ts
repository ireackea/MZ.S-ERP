import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * FC-SEC-007 — translate data-layer integrity errors into 4xx.
 *
 * Prisma raises a bare `P2002` for a unique-constraint violation and a bare
 * `P2003` for a foreign-key one. Nest has no handler for either, so both
 * escaped as a 500 "Internal Server Error" with a stack trace. A caller who
 * submitted a username that already existed was told the server had crashed.
 *
 * This is a global filter on purpose. The same class of error arrives from
 * every module — items (SKU), partners (name), transactions (idempotency key),
 * orders — and a per-controller filter would translate the same table six
 * times and let the next new controller miss it. The existing global
 * `ValidationPipe` in main.ts is the same pattern for the same reason.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest();
    const target = `${request?.method || '?'} ${request?.url || '?'}`;

    switch (exception.code) {
      case 'P2002': {
        const target_field = this.describeTarget(exception);
        this.logger.warn(`[P2002] unique constraint on ${target} (${target_field})`);
        return context.getResponse().status(HttpStatus.CONFLICT).json({
          statusCode: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: target_field
            ? `A record with this ${target_field} already exists.`
            : 'A record with these values already exists.',
          code: 'DUPLICATE_VALUE',
        });
      }

      case 'P2003': {
        const target_field = this.describeTarget(exception);
        this.logger.warn(`[P2003] foreign key constraint on ${target} (${target_field})`);
        return context.getResponse().status(HttpStatus.CONFLICT).json({
          statusCode: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: target_field
            ? `This record is still referenced by other data (${target_field}) and cannot be changed.`
            : 'This record is still referenced by other data and cannot be changed.',
          code: 'REFERENCED_RECORD',
        });
      }

      default: {
        // Anything else keeps its previous behaviour, so this filter cannot
        // silently swallow a new Prisma error code.
        this.logger.error(`[${exception.code}] unhandled Prisma error on ${target}`, exception.stack);
        return context.getResponse().status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Internal Server Error',
          message: 'Internal Server Error',
          code: exception.code,
        });
      }
    }
  }

  /** Turn Prisma's `meta.target` into a field name a user can act on. */
  private describeTarget(exception: Prisma.PrismaClientKnownRequestError): string {
    const meta = exception.meta as { target?: unknown; field_name?: unknown } | undefined;
    const raw = meta?.target ?? meta?.field_name;
    if (Array.isArray(raw)) return raw.join(', ');
    if (typeof raw === 'string') return raw.replace(/^.*\(([^)]+)\)$/, '$1');
    return '';
  }
}
