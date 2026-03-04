import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ThemeService {
  constructor(private prisma: PrismaService) {}

  async getUserTheme(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return user.theme;
  }

  async updateUserTheme(userId: string, theme: string) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { theme } });
    return user;
  }
}
