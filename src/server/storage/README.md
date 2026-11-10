# storage

Object storage (S3 API) and the `file` table, which is the only table this module touches. Rows
are never deleted.

## Direct uploads (media never passes through the web server)

1. Server: `createUpload({ ownerId, projectId?, originalName, mimeType, sizeBytes, purpose })`
   checks the purpose's allowlist (`purposes.ts`), inserts a `pending` row and returns
   `{ fileId, uploadUrl, method: "PUT", headers, expiresAt }`. The caller checks project access.
2. Browser: `fetch(uploadUrl, { method, headers, body: file })`. The URL is signed for that exact
   `Content-Type` and `Content-Length`, so the store refuses anything else.
3. Server: `confirmUpload({ fileId, ownerId })` HEADs the object, compares size and type with the
   row (a mismatching object is deleted) and marks it `ready`. Safe to call twice.

Downloads: `getDownloadUrl({ fileId, userId, downloadName? })` returns a 5-minute presigned GET for
a ready file the user owns; anything else is the same `not_found`.

Server and workers: `readFileBytes`, `openFileStream` (large media) and `putFileBytes` (bytes or a
stream with known length; written as `pending`, then `ready`).

Storage keys: `u/<ownerId>/<projectId or "_">/<fileId>/<sanitized name>`. The display name is kept
in `original_name`.

## Configuration

`S3_ENDPOINT` is what the server uses; `S3_PUBLIC_ENDPOINT` (optional) is the origin browsers use
in presigned URLs. Signatures cover the host, so a reverse proxy in front of the store must pass
the `Host` header through unchanged.

The bucket needs CORS for the app's origins (methods `PUT`, `GET`, `HEAD`, any request header,
expose `ETag`). Locally `minio-init` sets it from `S3_CORS_ORIGINS`; in other environments apply
the same rule with `aws s3api put-bucket-cors` (see `docker-compose.yml`).
