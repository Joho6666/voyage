"use client";

import { CommandPalette } from "./CommandPalette";
import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { AssistantSheet } from "@/components/ai/AssistantSheet";
import { TooltipProvider } from "@/components/ui/tooltip";

export function TripShell({
  tripId,
  children,
  map,
}: {
  tripId: string;
  children: React.ReactNode;
  map?: React.ReactNode;
}) {
  return (
    <TooltipProvider>
      <div className="flex h-dvh overflow-hidden bg-background">
        <Sidebar tripId={tripId} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <div className="flex min-h-0 flex-1">
            <main className="min-w-0 w-full max-w-none border-r border-border md:w-[460px] md:max-w-[520px] md:shrink-0 lg:w-[500px]">
              {children}
            </main>
            <section className="relative hidden min-w-0 flex-1 md:block">{map}</section>
          </div>
        </div>
        <AssistantSheet />
        <CommandPalette />
        <MobileNav tripId={tripId} />
      </div>
    </TooltipProvider>
  );
}
