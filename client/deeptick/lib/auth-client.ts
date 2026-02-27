import { createAuthClient } from 'better-auth/react';

export type AuthSocialProvider = 'google' | 'github';

const SOCIAL_PROVIDER_LABELS: Record<AuthSocialProvider, string> = {
  google: 'Google',
  github: 'GitHub',
};

const isAuthSocialProvider = (value: string): value is AuthSocialProvider =>
  value === 'google' || value === 'github';

const configuredProviders = (process.env.NEXT_PUBLIC_AUTH_PROVIDERS ?? '')
  .split(',')
  .map((provider) => provider.trim().toLowerCase())
  .filter(isAuthSocialProvider);

// Single canonical auth client instance — used by AuthProvider and all auth operations
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
  fetchOptions: {
    credentials: 'include',
  },
});

export const authSocialProviders: AuthSocialProvider[] = configuredProviders;
export const authSocialProviderLabels = SOCIAL_PROVIDER_LABELS;
export const { useSession, signIn, signOut, signUp } = authClient;
