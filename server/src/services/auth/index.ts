import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '../../db/connection.js';
import { 
  user as userTable, 
  session as sessionTable, 
  account as accountTable, 
  verification as verificationTable 
} from '../../auth-schema.js';
import { config } from '../../config/index.js';

export const auth = betterAuth({
  baseURL: config.auth.url,
  basePath: '/api/auth',
  secret: config.auth.secret,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: userTable,
      session: sessionTable,
      account: accountTable,
      verification: verificationTable,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  socialProviders: config.auth.google ? {
    google: {
      clientId: config.auth.google.clientId,
      clientSecret: config.auth.google.clientSecret,
    },
  } : undefined,
  trustedOrigins: config.auth.trustedOrigins,
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
