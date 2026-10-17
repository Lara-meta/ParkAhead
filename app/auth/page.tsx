import { PageShell } from "@/components/page-shell";
import { SignIn } from "@/components/sign-in";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  let safe = "/";
  try {
    const u = new URL(returnTo ?? "/", "http://local");
    if (
      u.origin === "http://local" &&
      !returnTo?.includes("\\") &&
      /^\/(?:parking|legacy|eligibility|bookings\/[a-f0-9-]+(?:\/(?:zone|arrival))?|admin\/(?:demo|eligibility))?$/.test(
        u.pathname,
      )
    )
      safe = u.pathname + u.search;
  } catch {}
  return (
    <PageShell>
      <SignIn returnTo={safe} />
    </PageShell>
  );
}
