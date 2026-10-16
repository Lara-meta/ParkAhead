import Link from "next/link";
import { ParkingCircle } from "lucide-react";
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-[#e1e6df] bg-white">
        <nav className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 py-5">
          <Link className="flex items-center gap-2 text-xl font-bold" href="/">
            <ParkingCircle />
            ParkAhead.
          </Link>
          <div className="flex flex-wrap gap-5 text-sm">
            <Link href="/">Find parking</Link>
            <Link href="/demo-story">Demo story</Link>
            <Link href="/admin/demo">Demo controls</Link>
          </div>
        </nav>
      </header>
      <main>{children}</main>
    </>
  );
}
