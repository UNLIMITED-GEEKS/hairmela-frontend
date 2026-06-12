import { ErrorCode } from './error-codes';

export interface ApiError {
  statusCode: number;
  code: ErrorCode | null;
  message: string;
  details: unknown;
  timestamp: string;
  path: string;
  requestId: string | null;
}

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'statusCode' in value &&
    'message' in value &&
    'timestamp' in value
  );
}
