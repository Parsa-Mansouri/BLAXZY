/**
 * What the integration test files ask instead of probing on their own: the result of the single
 * probe in `global-setup.ts`. Outside vitest (no provided value) everything reads as unavailable.
 */
import { inject } from "vitest";

export type IntegrationStatus = {
  /** Postgres reachable, migrations applied. */
  database: boolean;
  /** The S3 bucket is reachable. */
  s3: boolean;
  ffmpeg: boolean;
  /** Why something is unavailable (empty when everything is). */
  reasons: string[];
};

declare module "vitest" {
  export interface ProvidedContext {
    integration: IntegrationStatus;
  }
}

export function integrationStatus(): IntegrationStatus {
  try {
    return inject("integration");
  } catch {
    return { database: false, s3: false, ffmpeg: false, reasons: ["no global setup"] };
  }
}

/** Postgres is usable (probed once by the global setup). */
export const databaseReachable = async (): Promise<boolean> => integrationStatus().database;

/** Postgres and the S3 bucket are usable. */
export const servicesReachable = async (): Promise<boolean> => {
  const s = integrationStatus();
  return s.database && s.s3;
};

/** ffmpeg is usable (probed once by the global setup). */
export const ffmpegReady = async (): Promise<boolean> => integrationStatus().ffmpeg;
