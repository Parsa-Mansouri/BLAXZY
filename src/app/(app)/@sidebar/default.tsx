import { LibrarySidebar } from "../_components/library-sidebar";

/** Fallback for the sidebar slot on a full page load of any route without its own slot page. */
export default function SidebarDefault() {
  return <LibrarySidebar />;
}
