import { Elysia } from 'elysia';
import { auth } from '../services/auth/index.js';
import { authRequiredError } from '../utils/api-error.js';

/**
 * Auth macro plugin — provides the `{ auth: true }` macro for routes.
 * When `auth: true` is set on a route, validates the session via Better Auth
 * and resolves `user` and `session` into the route context.
 * Returns 401 if no valid session.
 *
 * Usage: `.use(authMacro)` in any Elysia route group, then `{ auth: true }` on routes.
 */
export const authMacro = new Elysia({ name: 'auth-macro' })
    .macro({
        auth: {
            async resolve({ status, request: { headers } }) {
                const session = await auth.api.getSession({ headers });

                if (!session) {
                    return status(401, authRequiredError());
                }

                return {
                    user: session.user,
                    session: session.session,
                };
            },
        },
    });

/**
 * Better Auth handler plugin — mounts the auth handler at /api/auth.
 * Handles sign-in, sign-up, session, sign-out, OAuth callbacks, etc.
 */
export const betterAuthPlugin = new Elysia({ name: 'better-auth' })
    .mount(auth.handler);
