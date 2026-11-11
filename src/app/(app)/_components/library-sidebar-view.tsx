"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, LayoutGrid, Plus } from "lucide-react";
import {
  SidebarAction,
  SidebarBody,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarSection,
} from "@/ui";
import { Wordmark } from "@/app/_components/wordmark";
import { NewProjectDialog } from "../dashboard/_components/new-project-dialog";
import { SidebarAccount } from "./sidebar-account";

/**
 * The floating library sidebar (Home.dc.html): wordmark, an outlined New Project, HOME and
 * PROJECTS, the recent films as single rows under a hairline, and the account row at the foot.
 */
export function LibrarySidebarView({
  name,
  email,
  recent,
}: {
  name: string;
  email: string;
  recent: { id: string; title: string }[];
}) {
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <SidebarHeader>
        <Wordmark href="/dashboard" />
      </SidebarHeader>
      <SidebarAction icon={<Plus strokeWidth={1.5} />} onClick={() => setCreating(true)}>
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
          <SidebarItem
            variant="nav"
            icon={<LayoutGrid strokeWidth={1.5} />}
            selected={pathname === "/projects"}
            render={<Link href="/projects" />}
          >
            Projects
          </SidebarItem>
        </SidebarSection>
        {recent.length > 0 ? (
          <SidebarSection title="Recent films" divided>
            {recent.map((project) => {
              const href = `/projects/${project.id}`;
              return (
                <SidebarItem
                  key={project.id}
                  tooltip={project.title}
                  selected={pathname === href || pathname.startsWith(`${href}/`)}
                  render={<Link href={href} />}
                >
                  {project.title}
                </SidebarItem>
              );
            })}
          </SidebarSection>
        ) : null}
      </SidebarBody>
      <SidebarFooter>
        <SidebarAccount name={name} email={email} />
      </SidebarFooter>
      <NewProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
