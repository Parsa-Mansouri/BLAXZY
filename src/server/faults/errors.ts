/** The errors the real dependencies throw, built for the fault hooks. */
import { APIConnectionError, APIError } from "@anthropic-ai/sdk";
import { S3ServiceException } from "@aws-sdk/client-s3";
import { ProviderError } from "@/server/providers/errors";
import type { FaultKind } from "./parse";

const ANTHROPIC_BODIES: Record<number, { type: string; message: string }> = {
  429: { type: "rate_limit_error", message: "Injected fault: rate limited" },
  500: { type: "api_error", message: "Injected fault: internal server error" },
  529: { type: "overloaded_error", message: "Injected fault: overloaded" },
};

/** An Anthropic SDK error, as the client throws it (429 carries `retry-after`). */
export function claudeFaultError(
  kind: Exclude<FaultKind<"claude">, "malformed">,
  retryAfterSeconds = 1,
): Error {
  if (kind === "connection") {
    return new APIConnectionError({ message: "Injected fault: connection error" });
  }
  const status = kind === "429" ? 429 : kind === "529" ? 529 : 500;
  const body = ANTHROPIC_BODIES[status] ?? { type: "api_error", message: "Injected fault" };
  const headers = new Headers(kind === "429" ? { "retry-after": String(retryAfterSeconds) } : {});
  return APIError.generate(status, { type: "error", error: body }, body.message, headers);
}

/** What the provider layer throws for an injected fault (`lost` is a status, not an error). */
export function providerFaultError(kind: Exclude<FaultKind<"provider">, "lost">): ProviderError {
  switch (kind) {
    case "5xx":
      return new ProviderError("Injected fault: the provider answered 503", true);
    case "429":
      return new ProviderError("Injected fault: the provider rate limit was hit", true);
    case "timeout":
      return new ProviderError("Injected fault: the provider timed out", true, {
        cause: new DOMException("The operation timed out", "TimeoutError"),
      });
    case "fatal":
      return new ProviderError("Injected fault: the provider rejected the request", false);
  }
}

export function s3FaultError(): S3ServiceException {
  return new S3ServiceException({
    name: "InternalError",
    message: "Injected fault: We encountered an internal error. Please try again.",
    $fault: "server",
    $metadata: { httpStatusCode: 500 },
  });
}

export function emailFaultError(): Error {
  return Object.assign(new Error("Injected fault: connect ECONNREFUSED (email send failed)"), {
    code: "ECONNECTION",
  });
}
