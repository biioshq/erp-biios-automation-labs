"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Bell, CheckCheck, CircleAlert, Info, PackageX, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationDTO,
} from "../actions";

const ICONS = {
  danger: PackageX,
  warning: TriangleAlert,
  success: CheckCheck,
  info: Info,
} as const;

const TONES = {
  danger: "text-danger bg-danger/10",
  warning: "text-warning bg-warning/10",
  success: "text-success bg-success/10",
  info: "text-info bg-info/10",
} as const;

/**
 * The bell. Refreshes on navigation, on window focus, after mutations
 * (erp:data-changed) and every minute, and raises a toast when a new unread
 * notification (low stock, out of stock, task assigned) arrives.
 */
export function NotificationsMenu() {
  const pathname = usePathname();
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const seen = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    const data = await getNotifications().catch(() => null);
    if (!data) return;
    if (seen.current) {
      for (const n of data.items) {
        if (!seen.current.has(n.id) && !n.read) {
          const notify = n.severity === "danger" ? toast.error : n.severity === "warning" ? toast.warning : toast.info;
          notify(n.title, { description: n.body ?? undefined });
        }
      }
    }
    seen.current = new Set(data.items.map((n) => n.id));
    setItems(data.items);
    setUnread(data.unread);
  }, []);

  useEffect(() => {
    void refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    const id = window.setInterval(refresh, 60_000);
    const onChange = () => void refresh();
    window.addEventListener("focus", onChange);
    window.addEventListener("erp:data-changed", onChange);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onChange);
      window.removeEventListener("erp:data-changed", onChange);
    };
  }, [refresh]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
          <Bell />
          <AnimatePresence>
            {unread > 0 ? (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="tabular absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-[#1b1306]"
              >
                {unread > 9 ? "9+" : unread}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(calc(100vw-1rem),380px)] p-0" collisionPadding={8}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Notifications</p>
            <p className="text-xs text-muted-foreground">{unread ? `${unread} unread` : "You're all caught up"}</p>
          </div>
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                startTransition(async () => {
                  setItems((prev) => prev.map((n) => ({ ...n, read: true })));
                  setUnread(0);
                  await markAllNotificationsRead();
                })
              }
            >
              <CheckCheck /> Mark all read
            </Button>
          ) : null}
        </div>
        <ScrollArea className="**:data-[slot=scroll-area-viewport]:max-h-[min(420px,65svh)]">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <div className="rounded-full bg-muted p-3">
                <Bell className="size-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No notifications yet</p>
              <p className="text-xs text-muted-foreground">Low stock alerts and task updates will appear here.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const Icon = ICONS[n.severity] ?? CircleAlert;
                const content = (
                  <div className={cn("flex gap-3 px-4 py-3 transition-colors hover:bg-muted/60", !n.read && "bg-accent/40")}>
                    <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full", TONES[n.severity])}>
                      <Icon className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug font-medium">{n.title}</p>
                      {n.body ? <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p> : null}
                      <p className="mt-1 text-[11px] text-muted-foreground/80">{formatRelative(n.createdAt)}</p>
                    </div>
                    {!n.read ? <span className="mt-2 size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" /> : null}
                  </div>
                );
                const onClick = () => {
                  setOpen(false);
                  if (!n.read) {
                    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
                    setUnread((u) => Math.max(0, u - 1));
                    void markNotificationRead(n.id);
                  }
                };
                return (
                  <li key={n.id}>
                    {n.href ? (
                      <Link href={n.href} onClick={onClick} className="block">
                        {content}
                      </Link>
                    ) : (
                      <button type="button" onClick={onClick} className="block w-full text-left">
                        {content}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
