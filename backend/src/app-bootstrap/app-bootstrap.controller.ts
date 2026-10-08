import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AppBootstrapService } from './app-bootstrap.service';

/**
 * C5 / #17 — `JwtAuthGuard`, not `OptionalJwtAuthGuard`.
 *
 * `OptionalJwtAuthGuard` returns `true` even when authentication failed, so this
 * endpoint answered HTTP 200 to a caller with no session at all and handed over the
 * whole reference dictionary, every unloading rule with its **penalty rate per minute**,
 * and three counts that disclose whether the system holds data. Verified live, not
 * argued from the source.
 *
 * Requiring a session costs the client nothing: `useAppBootstrap` already treats a 401
 * as `outcome: 'anonymous'`, which is the answer an unauthenticated visitor gets. That
 * branch was written for a refusal this endpoint could not produce.
 *
 * No `@Permissions` here on purpose: every authenticated role needs its own session,
 * reference data and unloading rules to render the app, and the payload is already
 * scoped — inactive unloading rules go only to the two settings permissions.
 */
@UseGuards(JwtAuthGuard)
@Controller('app')
export class AppBootstrapController {
  constructor(private readonly appBootstrapService: AppBootstrapService) {}

  @Get('bootstrap')
  async getBootstrap(@Req() req: any) {
    return this.appBootstrapService.getBootstrapPayload(req?.user || null);
  }
}