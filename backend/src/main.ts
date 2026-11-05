import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { config } from './config';

export function configureApp(app: import('@nestjs/common').INestApplication) {
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  // Security headers (security test, 2026-11-05). SAMEORIGIN, not DENY: the job post page shows the circular PDF in a frame.
  const http = app.getHttpAdapter().getInstance?.();
  http?.disable?.('x-powered-by');
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  // The API lives under /api; send anyone opening the bare server address to the web app.
  app.getHttpAdapter().get('/', (_req: unknown, res: { redirect: (code: number, url: string) => void }) => res.redirect(302, config.webUrl));
  // DTO validation with class-validator runs before any business logic (SRS 21.1).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  return app;
}

async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule));
  app.enableShutdownHooks();
  // Candidate names and CVs may contain Bangla text; a non-UTF8 database would reject them.
  const [{ server_encoding }] = await app.get(DataSource).query('SHOW server_encoding');
  if (server_encoding !== 'UTF8') {
    Logger.error(`Database encoding is ${server_encoding}; ARS requires UTF8 (CREATE DATABASE ... ENCODING 'UTF8').`, 'Bootstrap');
  }
  await app.listen(config.port);
  Logger.log(`ARS API listening on http://localhost:${config.port}/api`, 'Bootstrap');
}

if (require.main === module) bootstrap();
