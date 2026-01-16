import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ProfileService } from './profile.service.js';
import { UpsertProfileDto } from './profile.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get(':userId')
  get(@Param('userId') userId: string) {
    return this.profileService.getProfile(userId);
  }

  @Post()
  upsert(@Body() body: UpsertProfileDto) {
    return this.profileService.upsertProfile(body);
  }

  @Delete(':userId')
  remove(@Param('userId') userId: string) {
    return this.profileService.deleteProfile(userId);
  }
}
