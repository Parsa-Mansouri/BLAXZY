import { toAuthFailure, type AuthFailure } from "./auth-errors";

type ClientError = { status: number; code?: string; message?: string };
type FetchOptions = { onError: (context: { response: Response }) => void };

export type AuthResult<T> = { ok: true; data: T } | { ok: false; failure: AuthFailure };

/**
 * Runs a better-auth client call and normalises the outcome. Pass the provided `fetchOptions`
 * to the call (`authClient.signIn.email({ ...body, fetchOptions })`) so the 429 `X-Retry-After`
 * header is captured.
 */
export async function callAuth<T>(
  run: (fetchOptions: FetchOptions) => Promise<{ data: T | null; error: ClientError | null }>,
): Promise<AuthResult<T>> {
  let retryAfter: string | null = null;
  const fetchOptions: FetchOptions = {
    onError: ({ response }) => {
      retryAfter = response.headers.get("X-Retry-After");
    },
  };
  try {
    const { data, error } = await run(fetchOptions);
    if (error) return { ok: false, failure: toAuthFailure(error, retryAfter) };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, failure: { status: 0 } };
  }
}
