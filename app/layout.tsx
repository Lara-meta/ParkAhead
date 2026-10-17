import type { Metadata } from "next";
import "./globals.css";
import { DemoModeIndicator } from "@/components/demo-mode-indicator";
export const metadata: Metadata = {
  referrer: "no-referrer",
  title: {
    default: "ParkAhead. · Plan your parking",
    template: "%s · ParkAhead.",
  },
  icons: { icon: "/icon.svg" },
  description:
    "Choose parking across four fictional malls, with clear bay types and mall-scoped OKU eligibility.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DemoModeIndicator />
        {children}
      </body>
    </html>
  );
}
