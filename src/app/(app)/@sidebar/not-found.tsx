import { LibrarySidebar } from "../_components/library-sidebar";

/** A project that is missing or not the user's: the sidebar falls back to the library. */
export default function SidebarNotFound() {
  return <LibrarySidebar />;
}
