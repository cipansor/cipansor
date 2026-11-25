"use client";

import { MainLayout } from "@/components/layout/main-layout";
import { CalendarEventForm } from "@/components/calendar/calendar-event-form";

export default function NewEventPage() {
  return (
    <MainLayout>
      <CalendarEventForm />
    </MainLayout>
  );
}
