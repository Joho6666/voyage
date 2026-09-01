import { Suspense } from "react";
import { NewTripExperience } from "@/features/new-trip/NewTripExperience";

export default function NewTripPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <NewTripExperience />
    </Suspense>
  );
}
