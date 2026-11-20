"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Boxes, FolderKanban, ListTodo, Moon, Receipt, BadgeIndianRupee, Search, Sun, Zap } from "lucide-react";
import {
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
import { MODULES, QUICK_ACTIONS, modulePages } from "@/config/navigation";
import { globalSearch, type SearchGroups } from "@/features/search/actions";

const GROUPS: { key: keyof SearchGroups; heading: string; icon: typeof Receipt }[] = [
  { key: "projects", heading: "Projects", icon: FolderKanban },
  { key: "expenses", heading: "Expenses", icon: Receipt },
  { key: "income", heading: "Income", icon: BadgeIndianRupee },
  { key: "inventory", heading: "Inventory", icon: Boxes },
  { key: "tasks", heading: "Tasks", icon: ListTodo },
];

/** ⌘K / Ctrl+K: jump to any page, run a quick action, or search records across modules. */
export function CommandMenu() {
  const router = useRouter();
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

  const hasHits = useMemo(() => results && GROUPS.some((g) => results[g.key].length > 0), [results]);

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
        <CommandInput placeholder="Search projects, expenses, items, tasks… or type a command" value={query} onValueChange={setQuery} />
        <CommandList className="max-h-[calc(100svh-6.5rem)] sm:max-h-[420px]">
          <CommandEmpty>{searching ? "Searching…" : "No results found."}</CommandEmpty>

          {searching && !results ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Spinner className="size-3.5" /> Searching records…
            </div>
          ) : null}

          {results && hasHits
            ? GROUPS.map(({ key, heading, icon: Icon }) =>
                results[key].length ? (
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

          <CommandGroup heading="Quick actions">
            {QUICK_ACTIONS.map((a) => (
              <CommandItem key={a.href} value={`${a.title} ${(a.keywords ?? []).join(" ")}`} onSelect={() => go(a.href)}>
                <Zap className="text-brand-ink" />
                {a.title}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          {MODULES.map((m) => (
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
      </CommandDialog>
    </>
  );
}
