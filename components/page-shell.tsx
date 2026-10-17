import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-[var(--border)] bg-white">
        <nav className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 py-5">
          <Link className="flex items-center gap-2 text-xl font-bold" href="/">
            <BrandLogo />
          </Link>
          <div className="flex flex-wrap gap-5 text-sm">
            <Link href="/">Find parking</Link>
            <Link href="/demo-story">Demo story</Link>
            <Link href="/admin/demo">Demo controls</Link>
            <Link href="/eligibility">OKU eligibility</Link>
            <Link href="/admin/eligibility">Eligibility reviews</Link>
          </div>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        <BrandLogo size="sm" />
        <span>Fictional parking layouts · Software availability only</span>
      </footer>
    </>
  );
}
