"use client";

import { Providers } from "./_components/providers";
import { StandaloneError } from "./_components/standalone-error";
import "./globals.css";

/**
 * A failure in the root layout itself. It replaces the root layout, so it brings its own
 * document, styles and providers (node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/error.md, "Global Error"). The fonts fall back to the system's.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>Something Went Wrong · BLAXZY</title>
        <Providers>
          <StandaloneError error={error} retry={retry} />
        </Providers>
      </body>
    </html>
  );
}
