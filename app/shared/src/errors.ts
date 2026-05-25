// Error handling per api/conventions.md §5.
//
// All REST errors use:
//   { "error": { "code": "...", "message": "...", "traceId": "...", "details": {} } }

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    traceId?: string;
    details?: Record<string, unknown>;
  };
  [key: string]: unknown;
}

export class AppError extends Error {
  code: string;
  status: number;
  traceId?: string;
  details?: Record<string, unknown>;
  rawBody?: unknown;

  constructor(body: ErrorBody, status: number, rawBody: unknown = body) {
    super(body.error.message);
    this.name = 'AppError';
    this.code = body.error.code;
    this.status = status;
    this.traceId = body.error.traceId;
    this.details = normalizeDetails(body);
    this.rawBody = rawBody;
  }
}

function normalizeDetails(body: ErrorBody): Record<string, unknown> | undefined {
  const details = { ...(body.error.details ?? {}) };
  for (const key of ['runId', 'projectId', 'threadId']) {
    if (details[key] === undefined && body[key] !== undefined) {
      details[key] = body[key];
    }
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

export function isErrorResponse(body: unknown): body is ErrorBody {
  if (!body || typeof body !== 'object') return false;
  const err = (body as Record<string, unknown>).error;
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  return typeof e.code === 'string' && typeof e.message === 'string';
}

export async function parseError(response: Response): Promise<AppError> {
  try {
    const body = await response.json();
    if (isErrorResponse(body)) {
      return new AppError(body, response.status);
    }
  } catch {
    // fall through to generic error
  }
  return new AppError(
    {
      error: {
        code: response.status >= 500 ? 'internal_error' : 'bad_request',
        message: `HTTP ${response.status}: ${response.statusText}`,
      },
    },
    response.status,
  );
}
