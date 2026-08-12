import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import * as path from 'path';
import * as fs from 'fs';
import { validateEnv } from './common/env-validator';
import { Logger, ValidationPipe } from '@nestjs/common';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  // ── ENV validation — crash early if required vars missing ─────────────────
  validateEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false, // manually configured below
    logger: ['log', 'warn', 'error'],
  });

  // ── Trust proxy — REQUIRED when behind Nginx on VPS ─────────────────────
  // Without this, rate limiting uses Nginx IP instead of real client IP,
  // and X-Forwarded-For / X-Forwarded-Proto headers are ignored.
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Catalog pages use inline onclick= handlers — must allow unsafe-inline
          scriptSrc: ["'self'", "'unsafe-inline'"],
          // Allow inline event handlers (onclick=) in catalog pages
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://fonts.googleapis.com',
          ],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          // Allow API calls to qrserver for QR code images
          connectSrc: ["'self'", 'https://api.qrserver.com'],
        },
      },
    }),
  );

  // ── Global validation pipe ────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: false, // don't throw on extra props (lenient for legacy payloads)
      transform: true,
    }),
  );

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  app.enableShutdownHooks();

  // ── Body size limit ───────────────────────────────────────────────────────
  const express = require('express');
  // Webhook: raw buffer needed for HMAC signature verification
  app.use('/webhook', express.raw({ type: 'application/json', limit: '1mb' }));
  app.use(
    '/wa-webhook',
    express.raw({ type: 'application/json', limit: '1mb' }),
  );
  app.use(
    '/ig-webhook',
    express.raw({ type: 'application/json', limit: '1mb' }),
  );
  // All other routes: standard JSON with 1MB limit
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ── Static file serving ───────────────────────────────────────────────────
  const storageDir = path.join(process.cwd(), 'storage');
  fs.mkdirSync(storageDir, { recursive: true });
  // Block direct access to SQLite DB and WAL/SHM journal files
  app.use(/^\/storage\/.*\.db(-shm|-wal)?$/, (_req: any, res: any) => {
    res.status(403).json({ message: 'Forbidden' });
  });
  app.useStaticAssets(storageDir, { prefix: '/storage' });

  // ── Leaflet (self-hosted) ─────────────────────────────────────────────────
  // Was loaded from unpkg.com — blocked by our own CSP (script-src 'self'
  // only allows same-origin scripts) so the checkout/admin map never rendered
  // any tiles or controls in any browser. Serving it same-origin fixes that.
  const leafletDir = path.join(
    process.cwd(),
    'node_modules',
    'leaflet',
    'dist',
  );
  if (fs.existsSync(leafletDir)) {
    app.useStaticAssets(leafletDir, { prefix: '/vendor/leaflet' });
  }

  // ── Landing page at root "/" ──────────────────────────────────────────────
  const landingDir = path.join(process.cwd(), '../landing');
  if (fs.existsSync(landingDir)) {
    app.useStaticAssets(landingDir, { prefix: '/' });
  }

  // ── CORS ──────────────────────────────────────────────────────────────────
  const rawOrigins = (process.env.CORS_ORIGINS || '').trim();
  const allowedOrigins = rawOrigins
    ? rawOrigins
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : null;

  const isProduction = process.env.NODE_ENV === 'production';
  app.enableCors({
    origin: (origin, cb) => {
      // IMPORTANT: a disallowed origin must answer cb(null, false) — NOT an
      // Error. cb(Error) turns the request into a 500 even for plain form
      // POSTs and top-level navigations that CORS doesn't apply to (e.g. the
      // admin page-approve picker, where mobile browsers send "Origin: null"
      // after the Facebook redirect chain). cb(null, false) simply omits the
      // CORS headers: browsers still block cross-origin fetch/XHR reads, but
      // normal navigation keeps working.
      const deny = (why: string) => {
        logger.warn(`[CORS] No CORS headers for origin: ${why}`);
        cb(null, false);
      };
      // Allow requests with no Origin header (server-to-server, curl, etc.)
      if (!origin) return cb(null, true);
      // Always allow same-host requests (catalog pages fetch back to the API server)
      const serverHost = process.env.API_BASE_URL || '';
      if (serverHost && origin === serverHost) return cb(null, true);
      if (!allowedOrigins) {
        if (isProduction) return deny(`${origin} — set CORS_ORIGINS`);
        return cb(null, true);
      }
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // Allow any subdomain of allowed origins (e.g. api.flamboyai.com when app.flamboyai.com is allowed)
      let originHost: string;
      try {
        originHost = new URL(origin).hostname;
      } catch {
        return deny(origin);
      }
      const allowed = allowedOrigins.some((o) => {
        try {
          return (
            new URL(o).hostname.split('.').slice(-2).join('.') ===
            originHost.split('.').slice(-2).join('.')
          );
        } catch {
          return false;
        }
      });
      if (allowed) return cb(null, true);
      deny(origin);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  logger.log(`🚀  API      →  http://localhost:${port}`);
  logger.log(`📁  Storage  →  http://localhost:${port}/storage`);
  logger.log(`❤️   Health   →  http://localhost:${port}/health`);
  logger.log(
    `🌍  CORS     →  ${allowedOrigins ? allowedOrigins.join(', ') : 'ALL (dev)'}`,
  );

  // ── Graceful SIGTERM handler ──────────────────────────────────────────────
  // Waits for in-flight requests to finish before shutting down
  process.on('SIGTERM', async () => {
    logger.log('SIGTERM received — graceful shutdown starting...');
    await app.close();
    logger.log('Server closed gracefully');
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.log('SIGINT received — shutting down...');
    await app.close();
    process.exit(0);
  });
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
