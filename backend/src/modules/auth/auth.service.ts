import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  async login(email: string, password: string) {
    // TODO: Replace with real user store & password hashing.
    if (!email || !password) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload = { sub: email, role: 'user' };
    return { accessToken: await this.jwt.signAsync(payload) };
  }
}
