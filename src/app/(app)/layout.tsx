import { requireUser } from "@/server/auth";
import { AppHeader } from "./_components/app-header";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader name={user.name} email={user.email} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-(--gutter) py-8 sm:py-12">
        {children}
      </main>
    </div>
  );
}
