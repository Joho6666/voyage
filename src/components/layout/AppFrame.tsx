"use client";

import { CommandPalette } from "./CommandPalette";
import { Sidebar } from "./Sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <div className="flex min-h-dvh bg-background">
        <Sidebar />
        <div className="min-w-0 flex-1">{children}</div>
        <CommandPalette />
      </div>
    </TooltipProvider>
  );
}
