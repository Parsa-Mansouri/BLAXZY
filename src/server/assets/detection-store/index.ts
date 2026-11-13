/**
 * Asset Detector results in the database: applying one (`apply`), what the worker needs to run
 * the detector and its correction rounds (`worker`), and the review loop of the category screens
 * ("Something wrong with this list?": `review`).
 */
export { applyDetection, type ApplyDetectionResult, type DetectionRow } from "./apply";
export {
  getDetectionPanel,
  submitDetectionReview,
  type DetectionPanel,
  type DetectionWarning,
} from "./review";
export {
  detectionAnswered,
  hasDetectionFor,
  loadDetectionFix,
  loadDetectorState,
  recordFixFailure,
  type DetectionFixJob,
} from "./worker";
export type { DetectionSceneIndexEntry } from "@/server/db/schema";
