import { Elysia } from 'elysia';

export const healthRoutes = new Elysia({ prefix: '/api/health' })
  .get('/', () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'deeptick-stock-researcher',
    version: '1.0.0',
  }))

  .get('/ready', () => ({
    status: 'ready',
    timestamp: new Date().toISOString(),
  }));
