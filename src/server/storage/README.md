# storage

Object storage (S3 API) and the `file` table, which is the only table this module touches. Rows
are never deleted. A file's `status` is `pending` (ticket issued or server write in progress),
`ready`, or `abandoned` (an upload that never completed; the row is kept but every reader treats it
as missing).

## Direct uploads (media never passes through the web server)

1. Server: `createUpload({ ownerId, projectId?, originalName, mimeType, sizeBytes, purpose })`
   checks the purpose's allowlist (`purposes.ts`) and that the user holds fewer than
   `MAX_PENDING_UPLOADS_PER_OWNER` (50) unfinished tickets from the last 15 minutes (else
   `too_many_uploads`), inserts a `pending` row and returns
   `{ fileId, uploadUrl, method: "PUT", headers, expiresAt }`. The caller checks project access.
2. Browser: `fetch(uploadUrl, { method, headers, body: file })` with the returned headers exactly as
   given. The URL (valid 15 minutes) is signed for that exact `Content-Type`, `Content-Length` and
   `If-None-Match: *`, so the store refuses anything else.
3. Server: `confirmUpload({ fileId, ownerId })` HEADs the object, compares size and type with the
   row, reads the first bytes and checks them against the signature of the declared type, then
   marks the row `ready`. A mismatching object is deleted (`upload_mismatch`). Safe to call twice.
   Confirming a ticket the sweeper already retired is `not_found`.

**Write-once uploads.** The presigned URL stays usable until it expires, so without a guard the
browser could replace the bytes after `confirmUpload` accepted them. The signed `If-None-Match: *`
makes the store refuse (412) a PUT to a key that already holds an object. This needs a store that
implements conditional writes (AWS S3 and RustFS do). A store that ignores the header accepts the
second PUT: confirmed files then stay replaceable while their URL is valid.

**Abandoned uploads.** `sweepAbandonedUploads({ olderThanMinutes?, now?, batchSize? })` deletes the
object of every `pending` row older than the cutoff (default 60 minutes; the worker's `file.sweep`
passes 6 hours so a very large export that is still uploading is not swept) and marks the row
`abandoned`. Bounded per call, safe on several workers at once; a row whose object could not be
deleted stays pending and is retried by the next sweep.

Downloads: `getDownloadUrl({ fileId, userId, downloadName? })` returns a 5-minute presigned GET for
a ready file the user owns; anything else is the same `not_found`. Images (except SVG), video and
audio display inline; any other type is forced to download (`Content-Disposition: attachment`,
under `downloadName` when given). `getOwnedFileInfo(fileId, userId)` returns the record or `null`.

Server and workers: `readFileBytes`, `openFileStream` (large media) and `putFileBytes` (bytes or a
stream with known length). Both reads take `{ signal?, ownerId? }`: without `ownerId` there is no
ownership check (the caller must have authorised access); with it a file of another user is
`not_found`. Reads only return `ready` files. `putFileBytes` writes the row as `pending`, uploads,
then marks it `ready`; bytes held in memory are checked against the type's content signature
first (streams are not inspected). Streams above 64 MiB go up as a multipart upload in 16 MiB parts
(at most three in flight, so memory stays flat; a failed or aborted upload frees its parts). If the
upload or the final update fails the object is deleted and the row is marked `abandoned`, never left
pending.

Storage keys: `u/<ownerId>/<projectId or "_">/<fileId>/<sanitized name>`. The display name is kept
in `original_name`.

Errors (`StorageError.code`): `invalid_file`, `not_found`, `not_uploaded`, `upload_mismatch`,
`too_many_uploads`.

## Configuration

`S3_ENDPOINT` is what the server uses; `S3_PUBLIC_ENDPOINT` (optional) is the origin browsers use
in presigned URLs. Signatures cover the host, so a reverse proxy in front of the store must pass
the `Host` header through unchanged.

The bucket needs CORS for the app's origins (methods `PUT`, `GET`, `HEAD`, any request header,
expose `ETag`). Locally `minio-init` sets it from `S3_CORS_ORIGINS`; in other environments apply
the same rule with `aws s3api put-bucket-cors` (see `docker-compose.yml`).
