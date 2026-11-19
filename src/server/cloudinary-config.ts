/**
 * Cloudinary settings from the environment, in either form:
 *
 *   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET (used when all three are set), or
 *   CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
 *
 * Values pasted with spaces or quotes around them, or with the "NAME=" part copied into the value
 * box, are cleaned. Placeholders and hidden secrets copied from the Cloudinary console are reported
 * as problems that say what to fix, because Cloudinary would only answer with a bare 401.
 * Messages never repeat a pasted value: a value in the wrong box may hold the secret.
 */

export type CloudinarySettings = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  source: "variables" | "url";
  /** The cleaned CLOUDINARY_URL (source "url"), query options such as upload_prefix included. */
  url?: string;
};

export type CloudinaryStatus = {
  /** Some Cloudinary variable is set, so Cloudinary is the file storage. */
  wanted: boolean;
  /** Usable settings, or null when something is missing or cannot work. */
  settings: CloudinarySettings | null;
  /** What stops uploads, in words an admin can act on. */
  problems: string[];
  /** Things worth knowing that do not stop uploads. */
  notes: string[];
};

import { cleanEnvValue } from "./env-value";

type Fields = { cloudName?: string; apiKey?: string; apiSecret?: string };

/** Several settings in one box: line breaks, or another CLOUDINARY_ name inside the value. */
const SEVERAL_SETTINGS = /[\r\n]|CLOUDINARY_[A-Z_]+\s*=/i;

const PLACEHOLDER = /[<>]|^(your[\s_-]?)?(cloud[\s_-]?name|api[\s_-]?key|api[\s_-]?secret)$/i;
const HIDDEN = /\*{3,}|•{3,}/;

const URL_PATTERN = /^cloudinary:\/\/([^:@/]+):([^@/]+)@([^/?#]+)(.*)$/i;

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function checkFields(fields: Required<Fields>, source: "variables" | "url") {
  const problems: string[] = [];
  const notes: string[] = [];
  const name = {
    cloudName: source === "url" ? "The cloud name in CLOUDINARY_URL" : "CLOUDINARY_CLOUD_NAME",
    apiKey: source === "url" ? "The API key in CLOUDINARY_URL" : "CLOUDINARY_API_KEY",
    apiSecret: source === "url" ? "The API secret in CLOUDINARY_URL" : "CLOUDINARY_API_SECRET",
  };
  const where = "In Cloudinary open Settings > API Keys";

  if (PLACEHOLDER.test(fields.cloudName)) {
    problems.push(`${name.cloudName} is still a placeholder. ${where}: the Cloud name is shown at the top of the page.`);
  } else if (/[^A-Za-z0-9_-]/.test(fields.cloudName)) {
    // Not repeated in the message: a URL or a whole block pasted here would carry the secret.
    problems.push(`${name.cloudName} is not a cloud name: it has characters other than letters, numbers, "-" and "_" (spaces, ":" or "@" for example). Put only the short Cloud name from Settings > API Keys there.`);
  }

  if (PLACEHOLDER.test(fields.apiKey) || HIDDEN.test(fields.apiKey)) {
    problems.push(`${name.apiKey} is still a placeholder. ${where} and copy the API Key column.`);
  } else if (/\s/.test(fields.apiKey)) {
    problems.push(`${name.apiKey} contains spaces. Copy the API Key again from Settings > API Keys.`);
  } else if (!/^\d+$/.test(fields.apiKey)) {
    notes.push(`${name.apiKey} is usually a number (for example 123456789012345); check it is the API Key, not the key's name.`);
  }

  if (HIDDEN.test(fields.apiSecret)) {
    problems.push(`${name.apiSecret} was copied while hidden (*****). ${where}, click the eye icon next to the API Secret, then copy it.`);
  } else if (PLACEHOLDER.test(fields.apiSecret)) {
    problems.push(`${name.apiSecret} is still a placeholder. ${where}, click the eye icon next to the API Secret, then copy it.`);
  } else if (/\s/.test(fields.apiSecret)) {
    problems.push(`${name.apiSecret} contains spaces. Copy the API Secret again from Settings > API Keys.`);
  }
  if (fields.apiKey && fields.apiKey === fields.apiSecret) {
    problems.push(`${name.apiKey} and ${name.apiSecret} are the same value; the secret is the other, longer value.`);
  }
  return { problems, notes };
}

export function cloudinaryStatus(env: Record<string, string | undefined> = process.env): CloudinaryStatus {
  const vars: Fields = {
    cloudName: cleanEnvValue("CLOUDINARY_CLOUD_NAME", env.CLOUDINARY_CLOUD_NAME),
    apiKey: cleanEnvValue("CLOUDINARY_API_KEY", env.CLOUDINARY_API_KEY),
    apiSecret: cleanEnvValue("CLOUDINARY_API_SECRET", env.CLOUDINARY_API_SECRET),
  };
  const url = cleanEnvValue("CLOUDINARY_URL", env.CLOUDINARY_URL);
  const someVars = Boolean(vars.cloudName || vars.apiKey || vars.apiSecret);
  if (!url && !someVars) return { wanted: false, settings: null, problems: [], notes: [] };

  const crowded = (
    [
      ["CLOUDINARY_CLOUD_NAME", vars.cloudName],
      ["CLOUDINARY_API_KEY", vars.apiKey],
      ["CLOUDINARY_API_SECRET", vars.apiSecret],
      ["CLOUDINARY_URL", url],
    ] as const
  ).filter(([, value]) => value && SEVERAL_SETTINGS.test(value));
  if (crowded.length) {
    return {
      wanted: true,
      settings: null,
      problems: crowded.map(
        ([variable]) =>
          `${variable} holds several settings or lines. Give each value its own variable: CLOUDINARY_CLOUD_NAME = the Cloud name, CLOUDINARY_API_KEY = the API Key, CLOUDINARY_API_SECRET = the API Secret (one row each in Vercel).`,
      ),
      notes: [],
    };
  }

  if (vars.cloudName && vars.apiKey && vars.apiSecret) {
    const fields = vars as Required<Fields>;
    const { problems, notes } = checkFields(fields, "variables");
    if (url) notes.unshift("CLOUDINARY_URL is ignored because CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are all set.");
    return { wanted: true, settings: problems.length ? null : { ...fields, source: "variables" }, problems, notes };
  }

  const missing = [
    vars.cloudName ? null : "CLOUDINARY_CLOUD_NAME",
    vars.apiKey ? null : "CLOUDINARY_API_KEY",
    vars.apiSecret ? null : "CLOUDINARY_API_SECRET",
  ].filter((v): v is string => Boolean(v));

  if (url) {
    const match = URL_PATTERN.exec(url);
    if (!match) {
      return {
        wanted: true,
        settings: null,
        problems: [
          "CLOUDINARY_URL must look like cloudinary://<api_key>:<api_secret>@<cloud_name>. Or remove it and set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET instead.",
        ],
        notes: [],
      };
    }
    const fields = { apiKey: decode(match[1]!), apiSecret: decode(match[2]!), cloudName: decode(match[3]!) };
    const { problems, notes } = checkFields(fields, "url");
    if (someVars) notes.unshift(`CLOUDINARY_URL is used because ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set.`);
    return {
      wanted: true,
      settings: problems.length ? null : { ...fields, source: "url", url: `cloudinary://${match[1]}:${match[2]}@${match[3]}${match[4] ?? ""}` },
      problems,
      notes,
    };
  }

  return {
    wanted: true,
    settings: null,
    problems: [`${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} missing. Cloudinary needs all three: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.`],
    notes: [],
  };
}
