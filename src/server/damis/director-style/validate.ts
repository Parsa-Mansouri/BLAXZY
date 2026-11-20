import { STYLE_CARD_SECTIONS } from "./prompt";
import type { FilmDirectorCardOutput } from "./schema";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A Mode A card has sections 0 to 14 in order, each headed by its number and first word. */
export function checkStyleCard(output: FilmDirectorCardOutput): string[] {
  const card = output.card_markdown;
  const errors: string[] = [];
  let cursor = 0;
  STYLE_CARD_SECTIONS.forEach((name, i) => {
    const heading = new RegExp(
      `^#{1,4}\\s*${i}\\.\\s*\\**\\s*${escape(name.split(" ")[0] ?? name)}`,
      "imu",
    );
    const match = heading.exec(card.slice(cursor));
    if (!match) {
      errors.push(`card_markdown: section "${i}. ${name}" is missing or out of order`);
      return;
    }
    cursor += match.index + match[0].length;
  });
  return errors;
}
