import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Elysia } from 'elysia';
import '../polyfills/typebox-module.polyfill.js';

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
}));

vi.mock('../services/auth/index.js', () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
    handler: (_request: Request) =>
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      }),
  },
}));

import { authMacro } from './better-auth.plugin.js';

describe('authMacro', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
  });

  it('returns structured 401 error when no session exists', async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const app = new Elysia()
      .use(authMacro)
      .get('/private', ({ user }) => ({ userId: user.id }), { auth: true });

    const response = await app.handle(new Request('http://localhost/private'));

    expect(response.status).toBe(401);
    const body = await response.json() as { code: string; error: string };
    expect(body.code).toBe('AUTH_REQUIRED');
    expect(body.error).toBe('Authentication required');
  });

  it('injects session user for authenticated routes', async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: 'user_1', email: 'user@example.com' },
      session: { id: 'session_1' },
    });

    const app = new Elysia()
      .use(authMacro)
      .get('/private', ({ user }) => ({ userId: user.id }), { auth: true });

    const response = await app.handle(new Request('http://localhost/private'));

    expect(response.status).toBe(200);
    const body = await response.json() as { userId: string };
    expect(body.userId).toBe('user_1');
  });
});
