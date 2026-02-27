import { describe, expect, it } from 'vitest';
import { Elysia } from 'elysia';
import '../../polyfills/typebox-module.polyfill.js';
import { healthRoutes } from './health.routes.js';

describe('health routes', () => {
  it('returns service health', async () => {
    const app = new Elysia().use(healthRoutes);
    const response = await app.handle(new Request('http://localhost/api/health/'));

    expect(response.status).toBe(200);
    const body = await response.json() as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('deeptick-stock-researcher');
  });

  it('returns ready status', async () => {
    const app = new Elysia().use(healthRoutes);
    const response = await app.handle(new Request('http://localhost/api/health/ready'));

    expect(response.status).toBe(200);
    const body = await response.json() as { status: string };
    expect(body.status).toBe('ready');
  });
});
