"use client";

import { useParams } from "next/navigation";
import { MainLayout } from "@/components/layout/main-layout";
import { CalendarEventForm } from "@/components/calendar/calendar-event-form";

export default function EditEventPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <MainLayout>
      <CalendarEventForm eventId={id} />
    </MainLayout>
  );
}
