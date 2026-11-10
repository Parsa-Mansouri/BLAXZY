import { getAuth } from "./config";

export { getAuth, type Auth } from "./config";
export {
  getSession,
  requireAdmin,
  requireUser,
  type AuthSession,
  type AuthUser,
  type SessionResult,
} from "./session";
export { safeNextPath } from "./safe-next-path";
export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./constants";

/** better-auth's HTTP handler, mounted by `src/app/api/auth/[...all]/route.ts`. */
export function authHandler(request: Request): Promise<Response> {
  return getAuth().handler(request);
}
