// ENTERPRISE FIX: Phase 0 - Fatal Errors Fixed - Blueprint Compliant - 2026-03-02
import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from './decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

// ENTERPRISE FIX: Phase 0 - Fatal Errors Fixed - Blueprint Compliant - 2026-03-02
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private shouldUseSecureCookie(request: Request) {
    const forwardedProto = String(request.headers['x-forwarded-proto'] || '').toLowerCase();
    return process.env.NODE_ENV === 'production' || Boolean((request as any).secure) || forwardedProto === 'https';
  }

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto.username, dto.password);
    
    res.cookie('feed_factory_jwt', result.accessToken, {
      httpOnly: true,
      secure: this.shouldUseSecureCookie(req),
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000, 
    });

    // Valid pseudo-token to satisfy frontend interface without storing JWT or a generic dummy
    return {
      accessToken: 'httpOnly',
      tokenType: 'Bearer',
      expiresIn: result.expiresIn,
      user: result.user
    };
  }

  @Public()
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.clearCookie('feed_factory_jwt', {
      path: '/',
      httpOnly: true,
      secure: this.shouldUseSecureCookie(req),
      sameSite: 'lax',
    });
    return { success: true, message: 'Logged out successfully' };
  }
}
