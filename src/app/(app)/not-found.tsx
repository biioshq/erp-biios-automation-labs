import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { Page } from "@/components/shared/page";

export default function NotFound() {
  return (
    <Page className="justify-center">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="This record may have been deleted, or the link is wrong."
        action={
          <Button asChild variant="outline">
            <Link href="/finance">Back to Finance</Link>
          </Button>
        }
      />
    </Page>
  );
}
