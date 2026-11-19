/**
 * Environment values as people paste them into Vercel or a .env file: trims spaces and line
 * breaks, drops surrounding quotes and a "NAME=" prefix copied into the value box.
 */
const unquote = (value: string) => (value.length >= 2 && /^(["'`])[\s\S]*\1$/.test(value) ? value.slice(1, -1).trim() : value);

export function cleanEnvValue(name: string, raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  let value = unquote(raw.trim());
  const prefix = new RegExp(`^${name}\\s*=`, "i").exec(value);
  if (prefix) value = unquote(value.slice(prefix[0].length).trim());
  return value || undefined;
}
