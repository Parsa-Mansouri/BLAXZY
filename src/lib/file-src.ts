/** Address of a stored file for `<img>` / `<audio>` sources (served by `/api/files/[id]`). */
export function fileSrc(fileId: string): string {
  return `/api/files/${encodeURIComponent(fileId)}`;
}
