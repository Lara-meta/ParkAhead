import { PageShell } from "@/components/page-shell";
import { BookingJourney } from "@/components/bookings/booking-journey";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <PageShell>
      <BookingJourney token={token} screen="arrival" />
    </PageShell>
  );
}
