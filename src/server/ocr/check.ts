import "server-only";

/**
 * Admin check that the receipt reader works on this server: reads a small built-in image that
 * says "Grand Total 1,234.00". Used by /api/health?check=ocr. The error text is the real one
 * (for example a missing module on a serverless host), so an admin can act on it.
 */
const PROBE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAbgAAABGCAAAAACbTt6yAAAH/ElEQVR42u2ce3BU1R3HP3c3ZLN5FAORZyIQEoQBAiHyEAQLQhFqpxUUykN5F0pxyoCMyKuOiMMMVBGBYMFpCy0jECNCtTwmlKE8LK/IowlPy5AEKKCEhCWBJPvrH/fefd5slnamk5Xz/et3vuec+9u7n3vPOffcndUEpUiUTX0FCpySAqekwClwSgqckgKnwCkpcEoKnJICp8ApKXBKCpwCp6TAKSlwSmGBk10zs1pEx7casvTy/3DwBVqMt3BdC1RpuMc5pmnbFKpwwO3q8vwHJ65Vua7sfDNt8p16+cHf0tYGm8XzejRukNRveZl5/eUMa+WMeWLYZ/4/0KjsrC0P6Fmd3be5M3VSfu1GfZNYaImGbeznxffL85e1hvRi+S81H0ew2ZSWtbXfA4et/KPwWYBV1ZrsoHabnMZJtdgvIiLlz5lnOfiub7vXYJl/zxs99XZRK2oz6puswP0OWuUbceVU6F5T/8AtIhjc/igeW331wYU37cSfFBEZDaOPuW7/7Wl4yafdX7VAcFW9sS0scu3NQMu1NiIB3OVYWpR4iz+DTfULXOlXH/TDAlxPor4SEZEt8KyInNfob2LgpPfuakoguHWGcTuF1g8sjUgA9wrs9imehp/UL3AN9VEsENwlGGWEg6FIZBV8rpc/hfc97V4gMRBcF1KqTYI5lka9U/Di5N+f0GeQT7mTyHZ9ZVd8/zdtozdDxarnmkXHJA9ZX2Us+YrZOqhpdPLYM0aXQ2NSHEl9P6yqe4Y9Pjk9Lj59ygmAtdogeFp7isAMYeof8II5pUEh/Asy9HIa3DSbrfmLY0VAz6KTjLQDMNLODisjEhYn6y0GIf2qL+gJbJQr7cy+Pcr1istj9XL0lyIiMseozpxWxx3nfl3TW2pz3CLZepwlgRms5ri/B3/KZXDcCFfCDt+qffChERY4eS8/4I77BLYZYVeetDIiYaicDKetwWVpr+bdcks/mHHGdSuvHyzUK0YwraDi3Axoel9EFkNazu3yXV3Q6gA3D7p+WVa+p4d+JM9QGZAhTHA+Gg9n/M/Jdk6P7ndloDsQ3CIoMMKXaVBlYUQCuIFQag2OP4qIFMAvRETkXjOeNSreMifHgyIXoki/KSJSlkFocAU2ut0VEanohf2sF1xghocG900MbdxmwXUxdzjMM0qzaVQsgeAmwR0jnAnFFkYkzHHl8AMjjDH3OM4C0PNVgK/hFQCcWdzV26Uu0OcDuAlrqlmdBJCwqo5ROttNdhxAzFpqsr2+RYaHUsmPK1loDML8IS5t2KdJv1+il/Le46OWVqccZ4RxcNfCiISdkzioZa9kMACjRJ7Ry575/mV9Im8JArtpY6xt+qaFzr2XDj30qEsGe7y+RYaH0eYuhYya4CnabXBr4ykAvhsn418K7lGJzW6E0VBhYUQCuEZwwzwhERHJNWva+ja7vnv8ETPu6OO7C+ntWVqEXhadpbu3ZWHQAtI3Q/g63f/n3zJxg6c8vrq6aFXjvb2OAkwpSV1p0ceJu9rDEIeFUf8UFeS0g3+28zU8e8EJ5lD0xcEzF8vA5g6oALjjprkZNwuZ+k4NTcy4CVL6uM9gF5ghXJUuWlND8/dH+npa8q/6ZlXMzYP1ufaNCRa9EsBlPBy6IMHCiARwfWHni77GJc83AMD919YLEJU5ftd2iwPaH+adkebTq8bj1pEhhPaMu4Zz1tz4QD9jyI69Fc6bM5nX26pbMpQYnEqIamJhRMJQ2S+RrS6/VwX+9bPWSewvcwruHZmuWR0woQHXPc/yIVM3tHkb3IDEcDPUrtXPX2PUuXfig2uehCK+dbFY0zRNy4Q5mjbNU9sBzhvhBdpGWxiRAC52Krd9J4L9x/xnpg00O71meIcGvveI702UwWEzPhr6duvgbXCEdEe4GWrV1hnuRl9sSvHMtrGaZ8isgJjaO/aBg3pUdobeVkZEvI+b3Yy3v/aUyiYFzCJ3GZYKwIMTlkf8EZf26tHhs6FzD6DQIHcyn4HhZ6hFrhnE7hvqc2qdOWTOkQdIbEl78xlIf47zvs9r+RSb9Wtks5sXrYyIAJe0wVY5wBwfrw646N8kwWFMetWTr1oecUoDpn8H4JpeR+5pNqbfA6iYim2GcbuFkaEW5d5gfmdfYwTF64yHuZOMsYfoOouilQB33qb9UEsjMl6kbo2GIX++XFF6ZG48nbZBoc/uxQiYfOhKwccZxNDwXJXPtka+Hr0D6Tm3XXsySapjy+sN6LazvHxXlrG1tQ+WPigPylDXzsk66CMiY+CyX5t7qUS9fqqy8tRMG61v+VR4d06mwnwRqfkh9sVXXXkZ2PUXI0FGRLxIFTmcaXJ1zCqrSfADV5Jq1Cz5CPhpMDiZbfTtmVsHuJpfm9PdG24RkRsxQFZQhjDBdfS7IPNF5EIHs9T9GwkFTm4ZL7wdHxtNgoz6v+UF0OvY9gntH3Ok9F9+8bcJNv/n6BYnFnSKie045/y8CeMaxrW26L384OiU6MTeqw4k1jVOrzgysW2ss+2kY0s1gMdzMp3O5DAyWO90BTlp+euHtnDEPDF8y+E2ofs2PpD9TGNHmynHJ9Zm1Ddp34v/OemWmMcjpu/H7ypvtnrUuFnsnESeqrcUj1TgIlB/enf14EcOnKb+y0vNcUoKnJICp8ApKXBKCpwCp6TAKSlwSgqcAqekwCkpcAqckgKnpMApKXAKnJICp6TAKXBKCpySAqekwClwSv93/QeWbFdyx53RgAAAAABJRU5ErkJggg==",
  "base64",
);

export type ReaderCheck = { ok: boolean; message: string; durationMs: number };

export async function checkReader(): Promise<ReaderCheck> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  try {
    const { extractInvoice } = await import("./extract");
    const result = await extractInvoice(PROBE, "image/png");
    const read = result.fields.totalAmount.value === 1234 || /1,?234/.test(result.text);
    return read
      ? { ok: true, message: "The receipt reader works: it read the test image.", durationMs: ms() }
      : { ok: false, message: `The reader started but misread the test image ("${result.text.trim().slice(0, 60)}").`, durationMs: ms() };
  } catch (error) {
    // First line only: Node appends a long "Require stack" of server paths to module errors.
    const firstLine = (text: string) => text.split("\n")[0]!.trim();
    const reason =
      error instanceof Error
        ? `${firstLine(error.message)}${error.cause instanceof Error ? ` (${firstLine(error.cause.message)})` : ""}`
        : String(error);
    return { ok: false, message: `The receipt reader failed: ${reason}`, durationMs: ms() };
  }
}
