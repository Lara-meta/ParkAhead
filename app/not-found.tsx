import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { PageHeading } from "@/components/ui/page-elements";
export default function NotFound() {
  return (
    <PageShell>
      <section className="panel">
        <PageHeading>Page not found</PageHeading>
        <p className="my-5 muted">This parking page is unavailable.</p>
        <Link className="text-link" href="/">
          Find parking
        </Link>
      </section>
    </PageShell>
  );
}
