import type { Metadata } from "next";
import { VerifyEmailPanel } from "./verify-email-panel";

export const metadata: Metadata = { title: "Verify Email · BLAXZY" };

export default function VerifyEmailPage() {
  return <VerifyEmailPanel />;
}
