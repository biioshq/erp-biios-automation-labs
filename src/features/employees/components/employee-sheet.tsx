"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { FormSheet, FormSheetBody } from "@/components/shared/form-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchEmployee } from "../actions";
import type { EmployeeDetail, UserLinkOption } from "../types";
import { EmployeeForm } from "./employee-form";

/** The create / edit drawer, driven by ?new=1 and ?edit=<id>. Used by the list and the detail page. */
export function EmployeeSheet({ users }: { users: UserLinkOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isNew = searchParams.get("new") === "1";
  const editId = searchParams.get("edit");
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const close = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    params.delete("edit");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    setLoading(true);
    fetchEmployee(editId)
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          toast.error("That employee no longer exists.");
          close();
        }
        setDetail(d);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const open = isNew || Boolean(editId);
  const ready = editId ? detail?.id === editId && !loading : true;

  return (
    <FormSheet
      open={open}
      onOpenChange={(o) => !o && close()}
      title={isNew ? "Add employee" : "Edit employee"}
      description={isNew ? "Add someone to the team. You can assign projects from the project's Team tab." : detail && editId ? detail.code : undefined}
    >
      {!ready ? (
        <FormSheetBody>
          <div className="space-y-4" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </FormSheetBody>
      ) : isNew ? (
        <EmployeeForm users={users} onDone={close} onCancel={close} />
      ) : detail ? (
        <EmployeeForm key={detail.updatedAt} employee={detail} users={users} onDone={() => { setDetail(null); close(); }} onCancel={close} />
      ) : null}
    </FormSheet>
  );
}
