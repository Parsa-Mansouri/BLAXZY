/**
 * The character-sheet catalog codes whose fix may edit the previous sheet instead of drawing a
 * new one (the catalog's rule `previous_sheet_attachment`): fixes to the detail frames only
 * (SP01, SP02, ST18 to ST22) or to the backdrop tone only (SP03, ST13). When every selected code is
 * one of these, the backend attaches the previous sheet with the role `previous_sheet`.
 */
export const CHARACTER_SHEET_EDIT_CODES: readonly string[] = [
  "SP01",
  "SP02",
  "ST18",
  "ST19",
  "ST20",
  "ST21",
  "ST22",
  "SP03",
  "ST13",
];
