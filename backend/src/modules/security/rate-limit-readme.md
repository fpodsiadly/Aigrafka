# Rate limiting

Global rate limiting is enabled via `@nestjs/throttler` in `AppModule` (limit 20 req/min per IP).
Adjust in `ThrottlerModule.forRoot`.
