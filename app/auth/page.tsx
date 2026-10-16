import { PageShell } from "@/components/page-shell";
import { SignIn } from "@/components/sign-in";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  const safe =
    returnTo &&
    /^\/(?:arrival\/[a-f0-9-]+|bookings\/[a-f0-9-]+(?:\/zone)?|admin\/demo)?$/.test(
      returnTo,
    )
      ? returnTo
      : "/";
  return (
    <PageShell>
      <SignIn returnTo={safe} />
    </PageShell>
  );
}
