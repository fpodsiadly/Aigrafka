import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UpsertProfileDto } from './profile.dto.js';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  getProfile(userId: string) {
    return (this.prisma as any).profile.findUnique({ where: { userId } });
  }

  async upsertProfile(input: UpsertProfileDto) {
    return (this.prisma as any).profile.upsert({
      where: { userId: input.userId },
      update: { ...input },
      create: { ...input }
    });
  }

  async deleteProfile(userId: string) {
    await (this.prisma as any).profile.delete({ where: { userId } });
    return { deleted: true };
  }
}
