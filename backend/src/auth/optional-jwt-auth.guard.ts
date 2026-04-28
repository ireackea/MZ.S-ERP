import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await super.canActivate(context);
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) {
        throw error;
      }

      const request = context.switchToHttp().getRequest<{ user?: unknown }>();
      request.user = undefined;
    }

    return true;
  }
}