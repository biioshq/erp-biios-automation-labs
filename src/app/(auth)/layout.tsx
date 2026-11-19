import { BiiosLockup } from "@/components/brand/logo";

/**
 * Sign-in and sign-up: the lamp-lit house on evening navy (as on the company site) beside a
 * form that follows the theme, light by default.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-background text-foreground lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[#0b1929] text-[#f4ede3] lg:block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/house-hero-lamplight.webp" alt="" className="absolute inset-0 h-full w-full object-cover object-[60%_center]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgb(11_25_41/0.92)_0%,rgb(11_25_41/0.55)_40%,rgb(11_25_41/0.85)_100%)]" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <BiiosLockup ground="dark" height={36} />
          <div className="max-w-lg space-y-5">
            <p className="text-[12px] font-medium tracking-[0.14em] text-[#b5ada3] uppercase">Project Manager</p>
            <h1 className="text-[44px] leading-[1.08] font-medium tracking-[-0.015em]">
              Every rupee, every part, every task, in one place.
            </h1>
            <p className="text-base text-[#b5ada3]">
              Stock assigned to a project lands in its budget, its expenses and the GST report without a second entry.
            </p>
          </div>
          <p className="text-[12px] tracking-[0.14em] text-[#b5ada3] uppercase">Modular automation solutions</p>
        </div>
      </aside>
      <main className="relative flex min-h-dvh flex-col overflow-hidden px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8 lg:min-h-0 lg:py-12">
        {/* Phones and tablets: a soft lamp-light glow behind the lockup. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,rgb(255_136_0/0.12),transparent_65%)] lg:hidden"
        />
        <div className="relative lg:hidden">
          <BiiosLockup ground="light" height={36} className="dark:hidden" />
          <BiiosLockup ground="dark" height={36} className="hidden dark:block" />
        </div>
        <div className="relative flex flex-1 items-center justify-center py-8 lg:py-0">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
    </div>
  );
}
