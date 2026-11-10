import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession, safeNextPath } from "@/server/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · BLAXZY" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  const safeNext = safeNextPath(Array.isArray(next) ? next[0] : next, "/dashboard");
  if (await getSession()) redirect(safeNext);
  return <LoginForm next={safeNext} />;
}
