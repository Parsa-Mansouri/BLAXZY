import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Showcase } from "./showcase";

export const metadata: Metadata = { title: "UI kit" };

export default function UiKitPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Showcase />;
}
