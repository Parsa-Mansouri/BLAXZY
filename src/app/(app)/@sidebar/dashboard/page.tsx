import { LibrarySidebar } from "../../_components/library-sidebar";

// Every route has an explicit slot page so client navigation swaps the sidebar too.
export default function DashboardSidebar() {
  return <LibrarySidebar />;
}
