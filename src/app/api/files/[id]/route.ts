import { NextResponse } from "next/server";
import { getSession } from "@/server/auth";
import { checkRateLimit } from "@/server/ratelimit";
import { getDownloadUrl, StorageError } from "@/server/storage";

const SECURITY_HEADERS = { "X-Content-Type-Options": "nosniff" } as const;

/**
 * Stable address for a stored file the signed-in user owns: redirects to a short-lived presigned
 * URL, so pages can use `/api/files/<id>` as an image or audio source without holding URLs that
 * expire. The bytes never pass through the web server. Use `fileSrc()` to build the address.
 *
 * 401 without a session; 429 (with Retry-After) over the user's `read` rate limit; 404 for a
 * missing, foreign, pending or abandoned file (one answer for all). Any other error is not
 * caught, so it surfaces as a 500 and is logged by Next.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse(null, { status: 401, headers: SECURITY_HEADERS });
  const limit = await checkRateLimit({ userId: session.user.id, bucket: "file" });
  if (!limit.ok) {
    return new NextResponse(null, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds), ...SECURITY_HEADERS },
    });
  }
  const { id } = await params;
  try {
    const { url } = await getDownloadUrl({ fileId: id, userId: session.user.id });
    return NextResponse.redirect(url, {
      status: 302,
      headers: {
        // The redirect itself may be reused briefly; the target expires after five minutes.
        "Cache-Control": "private, max-age=120",
        ...SECURITY_HEADERS,
      },
    });
  } catch (error) {
    if (error instanceof StorageError && error.code === "not_found") {
      return new NextResponse(null, { status: 404, headers: SECURITY_HEADERS });
    }
    throw error;
  }
}
