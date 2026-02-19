import { Elysia, t } from 'elysia';
import { auth } from '../../services/auth/index.js';

export const authRoutes = new Elysia({ prefix: '/api/auth' })
  .post('/sign-up/email', async ({ body, set, headers }) => {
    try {
      const { email, password, name } = body as { email: string; password: string; name?: string };
      
      const result = await auth.api.signUpEmail({
        body: { email, password, name: name ?? 'New User' },
        headers: { cookie: headers.cookie as string || '' },
        returnHeaders: true,
      });

      const cookieHeader = result.headers.get('set-cookie');
      if (cookieHeader) {
        set.headers['set-cookie'] = cookieHeader;
      }
      
      set.status = 201;
      return result.response;
    } catch (error: unknown) {
      set.status = 400;
      return {
        error: error instanceof Error ? error.message : 'Sign up failed',
      };
    }
  }, {
    body: t.Object({
      email: t.String({ format: 'email' }),
      password: t.String({ minLength: 8 }),
      name: t.Optional(t.String()),
    }),
  })
  
  .post('/sign-in/email', async ({ body, set, headers }) => {
    try {
      const { email, password } = body as { email: string; password: string };
      
      const result = await auth.api.signInEmail({
        body: { email, password },
        headers: { cookie: headers.cookie as string || '' },
        returnHeaders: true,
      });

      const cookieHeader = result.headers.get('set-cookie');
      if (cookieHeader) {
        set.headers['set-cookie'] = cookieHeader;
      }
      
      return result.response;
    } catch (error: unknown) {
      set.status = 401;
      return {
        error: error instanceof Error ? error.message : 'Invalid credentials',
      };
    }
  }, {
    body: t.Object({
      email: t.String({ format: 'email' }),
      password: t.String(),
    }),
  })
  
  .post('/sign-out', async ({ headers, set }) => {
    try {
      const result = await auth.api.signOut({
        headers: { cookie: headers.cookie as string || '' },
        returnHeaders: true,
      });
      const cookieHeader = result.headers.get('set-cookie');
      if (cookieHeader) {
        set.headers['set-cookie'] = cookieHeader;
      }
    } catch {
    }

    if (!set.headers['set-cookie']) {
      set.headers['set-cookie'] = 'better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
    }

    return { success: true };
  })
  
  .get('/get-session', async ({ headers, set }) => {
    try {
      const session = await auth.api.getSession({ headers: { cookie: headers.cookie as string || '' } });
      
      if (!session) {
        set.status = 200; // Return 200 with null session for better-auth client
        return { session: null };
      }
      
      return session;
    } catch {
      set.status = 200; // Return 200 with null session for better-auth client
      return { session: null };
    }
  })
  
  .get('/list', async ({ headers, set }) => {
    try {
      const session = await auth.api.getSession({ headers: { cookie: headers.cookie as string || '' } });
      
      if (!session) {
        set.status = 200;
        return { sessions: [] };
      }
      
      return { sessions: [session.session] };
    } catch {
      set.status = 200;
      return { sessions: [] };
    }
  })
  
  .get('/callback/oauth/:provider', async ({ params, headers, set, query }) => {
    try {
      const { provider } = params;
      const code = query?.code as string | undefined;
      
      if (!code) {
        set.status = 400;
        return { error: 'Missing authorization code' };
      }

      const result = await (auth.api as any).signInOAuth({
        body: { provider, code },
        headers: { cookie: headers.cookie as string || '' },
        returnHeaders: true,
      });

      const cookieHeader = result.headers.get('set-cookie');
      if (cookieHeader) {
        set.headers['set-cookie'] = cookieHeader;
      }

      return result.response;
    } catch (error: unknown) {
      set.status = 400;
      return {
        error: error instanceof Error ? error.message : 'OAuth callback failed',
      };
    }
  })
  
  .post('/sign-in/oauth', async ({ body, set, headers }) => {
    const { provider } = body as { provider: string };
    
    try {
      const origin = headers.origin || 'http://localhost:3001';
      const callbackURL = `${origin}/api/auth/callback/oauth/${provider}`;
      
      const result = await (auth.api as any).signInOAuth({
        body: { provider, callbackURL },
        headers: { cookie: headers.cookie as string || '' },
        returnHeaders: true,
      });

      const cookieHeader = result.headers.get('set-cookie');
      if (cookieHeader) {
        set.headers['set-cookie'] = cookieHeader;
      }

      return result.response;
    } catch (error: unknown) {
      set.status = 400;
      return {
        error: error instanceof Error ? error.message : 'OAuth sign in failed',
      };
    }
  }, {
    body: t.Object({
      provider: t.String(),
    }),
  });
