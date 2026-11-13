import { getExport, type ExportView } from "@/server/production";
import type { ActionResult } from "../../../../../_lib/action";

export const FILM_MISSING = "This film is no longer available. Reload the page.";

/** The state of a ZIP export, for polling. */
export async function readExport(
  exportId: string,
  userId: string,
): Promise<ActionResult<ExportView>> {
  const view = await getExport(exportId, userId);
  return view ? { ok: true, data: view } : { ok: false, error: FILM_MISSING };
}
