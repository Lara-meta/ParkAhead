import { PageShell } from "@/components/page-shell";
import { BookingJourney } from "@/components/bookings/booking-journey";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PageShell>
      <BookingJourney id={id} screen="zone" />
    </PageShell>
  );
}
