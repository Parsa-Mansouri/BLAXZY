"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Film, House, LayoutGrid } from "lucide-react";
import { SidebarBody, SidebarFooter, SidebarHeader, SidebarItem, SidebarSection } from "@/ui";
import { Wordmark } from "@/app/_components/wordmark";
import { SidebarAccount } from "./sidebar-account";

export function LibrarySidebarView({
  name,
  email,
  credits,
  recent,
}: {
  name: string;
  email: string;
  credits: number;
  recent: { id: string; title: string }[];
}) {
  const pathname = usePathname();
  return (
    <>
      <SidebarHeader>
        <Wordmark href="/dashboard" />
      </SidebarHeader>
      <SidebarBody aria-label="Library">
        <SidebarSection title="Library">
          <SidebarItem
            icon={<House />}
            selected={pathname === "/dashboard"}
            render={<Link href="/dashboard" />}
          >
            Home
          </SidebarItem>
          <SidebarItem
            icon={<LayoutGrid />}
            selected={pathname === "/projects"}
            render={<Link href="/projects" />}
          >
            All Projects
          </SidebarItem>
        </SidebarSection>
        {recent.length > 0 ? (
          <SidebarSection title="Recent">
            {recent.map((project) => (
              <SidebarItem
                key={project.id}
                icon={<Film />}
                tooltip={project.title}
                render={<Link href={`/projects/${project.id}`} />}
              >
                {project.title}
              </SidebarItem>
            ))}
          </SidebarSection>
        ) : null}
      </SidebarBody>
      <SidebarFooter>
        <SidebarAccount name={name} email={email} credits={credits} />
      </SidebarFooter>
    </>
  );
}
