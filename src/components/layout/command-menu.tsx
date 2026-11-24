"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCanFn } from "@/components/current-user";
import { useTheme } from "next-themes";
import { Boxes, FolderKanban, ListTodo, Moon, Receipt, BadgeIndianRupee, Search, Sun, Zap } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { QUICK_ACTIONS, SETTINGS_PAGES, canOpen, modulePages, visibleModules } from "@/config/navigation";
import { globalSearch, type SearchGroups } from "@/features/search/actions";

/** Search result groups, each shown only to people who may view that kind of record. */
const GROUPS: { key: keyof SearchGroups; heading: string; icon: typeof Receipt; permission: string }[] = [
  { key: "projects", heading: "Projects", icon: FolderKanban, permission: "finance.projects:view" },
  { key: "expenses", heading: "Expenses", icon: Receipt, permission: "finance.expenses:view" },
  { key: "income", heading: "Income", icon: BadgeIndianRupee, permission: "finance.income:view" },
  { key: "inventory", heading: "Inventory", icon: Boxes, permission: "inventory.items:view" },
  { key: "tasks", heading: "Tasks", icon: ListTodo, permission: "tasks.tasks:view" },
];

/** ⌘K / Ctrl+K: jump to any page, run a quick action, or search records across modules. */
export function CommandMenu() {
  const router = useRouter();
  const can = useCanFn();
  const groups = useMemo(() => GROUPS.filter((g) => can(g.permission)), [can]);
  const quickActions = useMemo(() => QUICK_ACTIONS.filter((a) => canOpen(a, can)), [can]);
  const modules = useMemo(() => visibleModules(can), [can]);
  const settingsPages = useMemo(() => SETTINGS_PAGES.filter((p) => canOpen(p, can)), [can]);
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchGroups | null>(null);
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    const handle = window.setTimeout(() => {
      startSearch(async () => setResults(await globalSearch(query)));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [query]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  const hasHits = useMemo(() => results && groups.some((g) => results[g.key]?.length > 0), [results, groups]);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="hidden h-8 w-56 justify-start gap-2 rounded-lg bg-muted/40 px-2.5 text-muted-foreground shadow-none md:flex lg:w-72"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left text-[13px] font-normal">Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </Button>
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={() => setOpen(true)}>
        <Search />
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Search pages, actions and records">
        {/* The list must sit inside <Command>: cmdk's items read their store from it (without it, opening the menu crashed). */}
        <Command>
        <CommandInput placeholder="Search projects, expenses, items, tasks… or type a command" value={query} onValueChange={setQuery} />
        <CommandList className="max-h-[calc(100svh-6.5rem)] sm:max-h-[420px]">
          <CommandEmpty>{searching ? "Searching…" : "No results found."}</CommandEmpty>

          {searching && !results ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Spinner className="size-3.5" /> Searching records…
            </div>
          ) : null}

          {results && hasHits
            ? groups.map(({ key, heading, icon: Icon }) =>
                results[key]?.length ? (
                  <CommandGroup key={key} heading={heading}>
                    {results[key].map((hit) => (
                      <CommandItem key={hit.id} value={`${heading} ${hit.title} ${hit.subtitle}`} onSelect={() => go(hit.href)}>
                        <Icon />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate">{hit.title}</span>
                          <span className="truncate text-xs text-muted-foreground">{hit.subtitle}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null,
              )
            : null}

          {quickActions.length ? (
          <CommandGroup heading="Quick actions">
            {quickActions.map((a) => (
              <CommandItem key={a.href} value={`${a.title} ${(a.keywords ?? []).join(" ")}`} onSelect={() => go(a.href)}>
                <Zap className="text-brand-ink" />
                {a.title}
              </CommandItem>
            ))}
          </CommandGroup>
          ) : null}
          <CommandSeparator />
          {modules.map((m) => (
            <CommandGroup key={m.id} heading={m.title}>
              {modulePages(m).map((item) => (
                <CommandItem
                  key={item.href}
                  value={`${m.title} ${item.title} ${(item.keywords ?? []).join(" ")}`}
                  onSelect={() => go(item.href)}
                >
                  <item.icon />
                  {item.title}
                  <CommandShortcut>{m.title}</CommandShortcut>
                </CommandItem>
                ))}
            </CommandGroup>
          ))}
          {settingsPages.length ? (
            <CommandGroup heading="Settings">
              {settingsPages.map((item) => (
                <CommandItem key={item.href} value={`Settings ${item.title} ${(item.keywords ?? []).join(" ")}`} onSelect={() => go(item.href)}>
                  <item.icon />
                  {item.title}
                  <CommandShortcut>Settings</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          <CommandSeparator />
          <CommandGroup heading="Preferences">
            <CommandItem
              value="toggle theme dark light mode"
              onSelect={() => {
                setTheme(resolvedTheme === "dark" ? "light" : "dark");
                setOpen(false);
              }}
            >
              {resolvedTheme === "dark" ? <Sun /> : <Moon />}
              Switch to {resolvedTheme === "dark" ? "light" : "dark"} mode
            </CommandItem>
          </CommandGroup>
        </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
