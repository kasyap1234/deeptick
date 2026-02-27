export type ApiErrorCode =
  | 'AUTH_REQUIRED'
  | 'FEATURE_NOT_CONFIGURED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INTERNAL_SERVER_ERROR';

export interface ApiErrorBody {
  success: false;
  error: string;
  code: ApiErrorCode;
  retryable: boolean;
}

function isFeatureConfigError(message: string): boolean {
  return (
    message.includes('is required') ||
    message.includes('not configured') ||
    message.includes('Missing ')
  );
}

function isUpstreamError(message: string): boolean {
  return message.includes('Failed to ') || message.includes('API error');
}

export function toApiError(
  unknownError: unknown,
  fallbackMessage: string,
): { status: number; body: ApiErrorBody } {
  const internalMessage =
    unknownError instanceof Error && unknownError.message.trim().length > 0
      ? unknownError.message
      : fallbackMessage;

  if (isFeatureConfigError(internalMessage)) {
    return {
      status: 503,
      body: {
        success: false,
        error: fallbackMessage,
        code: 'FEATURE_NOT_CONFIGURED',
        retryable: false,
      },
    };
  }

  if (isUpstreamError(internalMessage)) {
    return {
      status: 502,
      body: {
        success: false,
        error: fallbackMessage,
        code: 'UPSTREAM_UNAVAILABLE',
        retryable: true,
      },
    };
  }

  return {
    status: 500,
    body: {
      success: false,
      error: fallbackMessage,
      code: 'INTERNAL_SERVER_ERROR',
      retryable: true,
    },
  };
}

export function authRequiredError(): ApiErrorBody {
  return {
    success: false,
    error: 'Authentication required',
    code: 'AUTH_REQUIRED',
    retryable: false,
  };
}
