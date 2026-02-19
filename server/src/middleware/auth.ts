import { auth } from '../services/auth/index.js';
import { getDb } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export interface AuthResult {
  success: true;
  userId: string;
}

export interface AuthError {
  success: false;
  error: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function authMiddleware({ cookie, set }: any): Promise<AuthResult | AuthError> {
  const sessionToken = cookie['better-auth.session_token']?.value;

  if (!sessionToken) {
    set.status = 401;
    return { success: false, error: 'Authentication required' };
  }

  try {
    const session = await auth.api.getSession({
      headers: { cookie: `better-auth.session_token=${sessionToken}` },
    });

    if (!session?.session) {
      set.status = 401;
      return { success: false, error: 'Invalid session' };
    }

    const userId = session.session.userId;
    const db = getDb();
    
    // Ensure user exists in the app's users table
    const existingUser = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (existingUser.length === 0) {
      // Auto-create user in users table if they don't exist
      await db.insert(users).values({
        id: userId,
        name: session.user?.name || 'User',
        email: session.user?.email || '',
        emailVerified: session.user?.emailVerified || false,
        image: session.user?.image,
      }).onConflictDoNothing();
    }

    return { success: true, userId };
  } catch {
    set.status = 401;
    return { success: false, error: 'Invalid session' };
  }
}

export function isAuthenticated(result: AuthResult | AuthError): result is AuthResult {
  return result.success === true;
}
