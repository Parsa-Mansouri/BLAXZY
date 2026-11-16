"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, Plus } from "lucide-react";
import {
  SidebarAction,
  SidebarBody,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarSection,
} from "@/ui";
import { Wordmark } from "@/app/_components/wordmark";
import { useCreateProject } from "../dashboard/_components/use-create-project";
import { SidebarAccount } from "./sidebar-account";

/**
 * The floating library sidebar: wordmark, an outlined New Project, HOME, and the account row at
 * the foot. The films themselves are on Home.
 */
export function LibrarySidebarView({ name, email }: { name: string; email: string }) {
  const pathname = usePathname();
  const { pending, create } = useCreateProject();
  return (
    <>
      <SidebarHeader>
        <Wordmark href="/dashboard" />
      </SidebarHeader>
      <SidebarAction icon={<Plus strokeWidth={1.5} />} onClick={create} disabled={pending}>
        New Project
      </SidebarAction>
      <SidebarBody aria-label="Library">
        <SidebarSection title="Library">
          <SidebarItem
            variant="nav"
            icon={<House strokeWidth={1.5} />}
            selected={pathname === "/dashboard"}
            render={<Link href="/dashboard" />}
          >
            Home
          </SidebarItem>
        </SidebarSection>
      </SidebarBody>
      <SidebarFooter>
        <SidebarAccount name={name} email={email} />
      </SidebarFooter>
    </>
  );
}
