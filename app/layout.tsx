import type { Metadata } from "next";
import "./globals.css";
import { DemoModeIndicator } from "@/components/demo-mode-indicator";
export const metadata: Metadata = {
  referrer: "no-referrer",
  title: "ParkAhead · A little planning. A better arrival.",
  description: "Reserve your parking at Demo Central Mall.",
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
