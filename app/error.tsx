"use client";

import { PageShell } from "@/components/page-shell";
import { PageHeading } from "@/components/ui/page-elements";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <PageShell>
      <section className="panel space-y-5">
        <PageHeading>Unable to load this page</PageHeading>
        <p className="muted">
          Refresh to check the latest parking information.
        </p>
        <Button onClick={reset}>Try again</Button>
      </section>
    </PageShell>
  );
}
