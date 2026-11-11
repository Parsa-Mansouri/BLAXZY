/**
 * Sign-in pages (Login.dc.html, Signup.dc.html): a rounded hero panel on the left and the form on
 * the right. Each page renders both through `AuthScreen`, so the title can differ per screen.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-wrap bg-ground">{children}</div>;
}
