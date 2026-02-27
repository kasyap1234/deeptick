import { describe, expect, it } from 'vitest';
import { toApiError } from './api-error.js';

describe('toApiError', () => {
  it('maps missing configuration errors to FEATURE_NOT_CONFIGURED', () => {
    const result = toApiError(new Error('EXASEARCH_API_KEY is required'), 'fallback');

    expect(result.status).toBe(503);
    expect(result.body.code).toBe('FEATURE_NOT_CONFIGURED');
    expect(result.body.retryable).toBe(false);
  });

  it('maps upstream failures to UPSTREAM_UNAVAILABLE', () => {
    const result = toApiError(new Error('Failed to list agents: 503'), 'fallback');

    expect(result.status).toBe(502);
    expect(result.body.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(result.body.retryable).toBe(true);
  });

  it('falls back to internal server error for unknown failures', () => {
    const result = toApiError(new Error('unexpected'), 'Internal server error');

    expect(result.status).toBe(500);
    expect(result.body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(result.body.error).toBe('Internal server error');
  });
});
