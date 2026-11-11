import { ClipsProvider } from "./_components/clips-context";

/** Keeps the live region and the move-on flag alive while the user goes from shot to shot. */
export default function ClipsLayout({ children }: { children: React.ReactNode }) {
  return <ClipsProvider>{children}</ClipsProvider>;
}
