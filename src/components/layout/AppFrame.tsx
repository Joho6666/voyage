"use client";

import { CommandPalette } from "./CommandPalette";
import { AppMobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <div className="flex min-h-dvh bg-background">
        <Sidebar />
        {/* Bottom padding keeps content clear of the mobile tab bar. */}
        <div className="min-w-0 flex-1 pb-14 md:pb-0">{children}</div>
        <CommandPalette />
        <AppMobileNav />
      </div>
    </TooltipProvider>
  );
}
