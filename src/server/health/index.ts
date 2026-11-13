/** Health checks for probes. Route handlers call this service, never the database directly. */
export { isDatabaseHealthy } from "@/server/db/health";
