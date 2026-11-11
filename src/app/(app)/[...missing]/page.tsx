import { notFound } from "next/navigation";

/** Any address with no page: shown inside the signed-in window by the app's not-found page. */
export default function MissingPage() {
  notFound();
}
