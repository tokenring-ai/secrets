import type { ConfigFieldMeta } from "@tokenring-ai/app/config/metadata";
import { z } from "zod";

/**
 * Configuration secrets — API keys, tokens, passwords.
 *
 * A secret is declared in a plugin's config schema with {@link secret}, and the
 * user picks where the value actually lives:
 *
 * - a literal string, stored in the config file as-is
 * - `{ source: "env", env: "SERPER_API_KEY" }` — read from the environment
 * - `{ source: "vault", category: "env", key: "SERPER_API_KEY" }` — read from
 *   the credential vault
 *
 * Plugins never read `process.env` themselves: they resolve the reference with
 * `resolveSecret(app, ref)` from ./SecretService.ts, which keeps the choice of
 * source in the user's hands and out of plugin code.
 */

export const SecretEnvRefSchema = z.object({
  source: z.literal("env"),
  env: z
    .string()
    .min(1)
    .meta({ label: "Variable Name", description: "Name of the environment variable holding the value" } satisfies ConfigFieldMeta),
  default: z
    .string()
    .min(1)
    .exactOptional()
    .meta({ description: "Value used when the environment variable (and vault env fallback) is unset" } satisfies ConfigFieldMeta),
});

export const SecretVaultRefSchema = z.object({
  source: z.literal("vault"),
  category: z
    .string()
    .min(1)
    .meta({ description: "Vault category the value is stored under" } satisfies ConfigFieldMeta),
  key: z
    .string()
    .min(1)
    .meta({ description: "Vault key within the category" } satisfies ConfigFieldMeta),
});

export const SecretRefSchema = z.union([z.string(), SecretEnvRefSchema, SecretVaultRefSchema]);

export type SecretEnvRef = z.output<typeof SecretEnvRefSchema>;
export type SecretVaultRef = z.output<typeof SecretVaultRefSchema>;
export type SecretRef = z.output<typeof SecretRefSchema>;

/** Where a secret's value comes from. `value` is a literal string in the config. */
export const secretSources = ["value", "env", "vault"] as const;
export type SecretSource = (typeof secretSources)[number];

/**
 * Declares a configuration secret. The result is a plain zod union, so it can be
 * wrapped with `.optional()`, `.default(...)`, etc. like any other schema:
 *
 * ```ts
 * apiKey: secret({ description: "Serper.dev API key" }).default(fromEnv("SERPER_API_KEY"))
 * ```
 */
export function secret(meta: ConfigFieldMeta = {}) {
  return SecretRefSchema.meta({ ...meta, secret: true, sensitive: true } satisfies ConfigFieldMeta);
}

/**
 * A value the user can point at any of the same three sources, but which isn't
 * a credential — a daemon host, an endpoint, an account id. Unlike
 * {@link secret} the literal form is shown in plain text and never redacted.
 */
export function sourcedValue(meta: ConfigFieldMeta = {}) {
  return SecretRefSchema.meta({ ...meta, secret: true, sensitive: false } satisfies ConfigFieldMeta);
}

/**
 * A config type with its secret-reference fields resolved to plain strings —
 * the shape a service receives once the plugin has resolved them:
 *
 * ```ts
 * export type ResolvedSerperOptions = WithResolvedSecrets<SerperOptions, "apiKey">;
 * ```
 */
export type WithResolvedSecrets<T, K extends keyof T> = Omit<T, K> & { [P in keyof Pick<T, K>]: string };

/** Reference to a value held in an environment variable, with an optional fallback when unset. */
export function fromEnv(env: string, defaultValue?: string): SecretEnvRef {
  return defaultValue === undefined ? { source: "env", env } : { source: "env", env, default: defaultValue };
}

/** Reference to a value held in the credential vault. */
export function fromVault(category: string, key: string): SecretVaultRef {
  return { source: "vault", category, key };
}

/** Which of the three sources a stored secret value uses. */
export function secretSourceOf(value: unknown): SecretSource {
  if (value && typeof value === "object" && "source" in value) {
    const src = value.source;
    if (src === "env") return "env";
    if (src === "vault") return "vault";
  }
  return "value";
}

/** Human-readable description of where a secret comes from, for error messages. */
export function describeSecretRef(ref: SecretRef | undefined): string {
  if (ref === undefined) return "an unset secret";
  if (typeof ref === "string") return "a value set directly in the configuration";
  if (ref.source === "env") return `the ${ref.env} environment variable or vault entry env/${ref.env}`;
  return `vault entry ${ref.category}/${ref.key}`;
}
