import * as React from "react"

/** Phones (below 768px): FormSheet turns into a bottom drawer. */
export const MOBILE_BREAKPOINT = 768
/** Phones and tablets (below 1024px): the sidebar becomes an off-canvas drawer. */
export const COMPACT_BREAKPOINT = 1024

function useMaxWidth(breakpoint: number) {
  const [matches, setMatches] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const onChange = () => setMatches(window.innerWidth < breakpoint)
    mql.addEventListener("change", onChange)
    onChange()
    return () => mql.removeEventListener("change", onChange)
  }, [breakpoint])

  return !!matches
}

export function useIsMobile() {
  return useMaxWidth(MOBILE_BREAKPOINT)
}

export function useIsCompact() {
  return useMaxWidth(COMPACT_BREAKPOINT)
}
