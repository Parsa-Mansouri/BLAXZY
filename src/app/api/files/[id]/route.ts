import { NextResponse } from "next/server";
import { getSession } from "@/server/auth";
import { getDownloadUrl, StorageError } from "@/server/storage";

/**
 * Stable address for a stored file the signed-in user owns: redirects to a short-lived presigned
 * URL, so pages can use `/api/files/<id>` as an image or audio source without holding URLs that
 * expire. The bytes never pass through the web server. Use `fileSrc()` to build the address.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse(null, { status: 401 });
  const { id } = await params;
  try {
    const { url } = await getDownloadUrl({ fileId: id, userId: session.user.id });
    return NextResponse.redirect(url, {
      status: 302,
      // The redirect itself may be reused briefly; the target expires after five minutes.
      headers: { "Cache-Control": "private, max-age=120" },
    });
  } catch (error) {
    if (error instanceof StorageError) return new NextResponse(null, { status: 404 });
    throw error;
  }
}
