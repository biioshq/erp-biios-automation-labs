"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * The create/edit/detail panel: a side sheet on desktop, a bottom drawer on phones.
 * Put a scrollable body and a sticky footer inside with <FormSheetBody> and <FormSheetFooter>.
 */
export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** md ≈ 560px, lg ≈ 760px (forms with side panels such as a receipt preview), xl ≈ 1040px. */
  size?: "md" | "lg" | "xl";
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
        <DrawerContent className="flex h-[94dvh] flex-col data-[vaul-drawer-direction=bottom]:max-h-[94dvh]">
          <DrawerHeader className="relative border-b py-3 pr-14 text-left">
            <DrawerTitle className="text-base leading-snug [overflow-wrap:anywhere]">{title}</DrawerTitle>
            {description ? <DrawerDescription className="text-pretty">{description}</DrawerDescription> : null}
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" className="absolute top-2 right-2" aria-label="Close">
                <XIcon />
              </Button>
            </DrawerClose>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={cn(
          "flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:max-w-[calc(100vw-1.5rem)] data-[side=right]:sm:max-w-[calc(100vw-1.5rem)]",
          size === "md" && "data-[side=right]:sm:w-[560px]",
          size === "lg" && "data-[side=right]:sm:w-[760px]",
          size === "xl" && "data-[side=right]:sm:w-[1080px]",
        )}
      >
        <SheetHeader className="border-b px-6 py-4 pr-14">
          <SheetTitle className="text-lg [overflow-wrap:anywhere]">{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export function FormSheetBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6", className)}>{children}</div>;
}

export function FormSheetFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-popover/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-6 sm:pb-3", className)}>
      {children}
    </div>
  );
}
