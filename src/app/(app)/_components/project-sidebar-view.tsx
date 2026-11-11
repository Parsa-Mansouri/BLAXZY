"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import {
  SidebarBody,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarSection,
  StageList,
  type StageListItem,
} from "@/ui";
import { useActiveStages } from "../_lib/use-active-stages";
import { Wordmark } from "@/app/_components/wordmark";
import { SidebarAccount } from "./sidebar-account";

export function ProjectSidebarView({
  name,
  email,
  title,
  stages,
}: {
  name: string;
  email: string;
  title: string;
  stages: StageListItem[];
}) {
  const items = useActiveStages(stages);
  return (
    <>
      <SidebarHeader>
        <Wordmark href="/dashboard" />
      </SidebarHeader>
      <SidebarBody aria-label="Project">
        <SidebarSection>
          <SidebarItem icon={<ChevronLeft />} render={<Link href="/projects" />}>
            Projects
          </SidebarItem>
        </SidebarSection>
        <div className="flex flex-col gap-2">
          <p className="px-2 text-title-3 break-words">{title}</p>
          <StageList stages={items} linkAs={Link} aria-label="Stages" />
        </div>
      </SidebarBody>
      <SidebarFooter>
        <SidebarAccount name={name} email={email} />
      </SidebarFooter>
    </>
  );
}
