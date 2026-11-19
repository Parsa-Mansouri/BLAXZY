/**
 * Development only: one live Seedance 2.5 text-to-video request through the official Higgsfield
 * SDK, to check the credentials and the SDK end to end. This is a billable generation.
 *
 *   pnpm hf:seedance        # reads HF_CREDENTIALS (KEY_ID:KEY_SECRET) from .env.local
 *
 * Prints the video URL and exits 0 only when the request completes with a video. A failed,
 * canceled or moderated request, or an SDK error, exits 1. The credentials are never printed.
 */
import { APIError, config, higgsfield, HiggsfieldError } from "@higgsfield/client/v2";

const MODEL = "bytedance/seedance-2.5/text-to-video";
const CREDENTIALS_FORMAT = /^[^:\s]+:\S+$/;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Removes the credentials (and each half of them) from any text before it is printed. */
function scrub(text: string, credentials: string): string {
  let out = text;
  for (const secret of [credentials, ...credentials.split(":")]) {
    if (secret.length >= 6) out = out.split(secret).join("[redacted]");
  }
  return out;
}

async function main(): Promise<void> {
  const credentials = process.env.HF_CREDENTIALS?.trim();
  if (!credentials || !CREDENTIALS_FORMAT.test(credentials)) {
    fail("HF_CREDENTIALS is missing or not in KEY_ID:KEY_SECRET format in .env.local.");
  }

  // Video takes longer than the SDK's 5 minute default polling limit.
  config({ credentials, pollInterval: 5000, maxPollTime: 15 * 60 * 1000 });

  console.log(`Submitting ${MODEL} (5 s, 720p, 16:9) and waiting for it to finish...`);
  try {
    const result = await higgsfield.subscribe(MODEL, {
      input: {
        prompt: "A cinematic scene at sunset",
        duration: 5,
        resolution: "720p",
        aspect_ratio: "16:9",
      },
      withPolling: true,
    });

    // The SDK types list queued | in_progress | completed | failed | nsfw; compare as a string so
    // a "canceled" (or any other) status from the API is also treated as not successful.
    const status: string = result.status;
    const url = result.video?.url;
    if (status === "completed" && url) {
      console.log(`Completed (request ${result.request_id}).`);
      console.log(`Video URL: ${url}`);
      return;
    }
    const reason =
      status === "nsfw"
        ? "blocked by moderation"
        : status === "completed"
          ? "completed without a video URL"
          : status;
    fail(`Generation did not succeed: ${reason} (request ${result.request_id}).`);
  } catch (error) {
    if (error instanceof APIError) {
      const detail = error.responseData ? ` ${JSON.stringify(error.responseData)}` : "";
      fail(
        scrub(
          `Higgsfield API error ${error.statusCode ?? ""}: ${error.message}${detail}`,
          credentials,
        ),
      );
    }
    if (error instanceof HiggsfieldError) {
      fail(scrub(`Higgsfield error (${error.name}): ${error.message}`, credentials));
    }
    fail(
      scrub(
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        credentials,
      ),
    );
  }
}

void main();
