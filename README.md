# @tokenring-ai/secrets

## Overview

Configuration secrets management for TokenRing plugins. API keys, tokens, and passwords are declared in a plugin's config schema, and the **user** decides where each value actually comes from.

Plugins never read `process.env` themselves. The `SecretService` is the single point of truth for resolving secrets from environment variables, the credential vault, or literal values stored in configuration.

### Key Features

- **Declarative secret references** -- Declare secrets in Zod config schemas with `secret()`, letting users choose the source
- **Three secret sources** -- Literal values, environment variables, or credential vault entries
- **Resolution order for env references** -- Process environment -> vault `env` category -> optional per-reference default
- **Non-secret sourced values** -- `sourcedValue()` for non-credential fields that need the same source flexibility without redaction
- **Type-safe resolution** -- `WithResolvedSecrets<T, K>` utility type for post-resolution config shapes
- **Sensitive value redaction** -- Automatic redaction of literal secret values in configuration UI and logs

## Installation

The plugin must be installed before any plugin that declares a secret -- resolving one without it raises "SecretService not found":

```ts
import SecretsPlugin from "@tokenring-ai/secrets/plugin";

export const plugins = [SecretsPlugin, ...otherPlugins];
```

## Declaring Secrets

Use `secret()` in a plugin's Zod config schema to declare a secret field. The result is a plain Zod union that can be wrapped with `.optional()`, `.default(...)`, etc.:

```ts
import { fromEnv, secret, type WithResolvedSecrets } from "@tokenring-ai/secrets";

export const SerperOptionsSchema = z.object({
  apiKey: secret({ description: "Serper.dev API key" }).default(fromEnv("SERPER_API_KEY")),
  defaults: SerperDefaultsSchema.exactOptional(),
});

export type SerperOptions = z.infer<typeof SerperOptionsSchema>;

/** Options as handed to the provider, with the secret already resolved. */
export type ResolvedSerperOptions = WithResolvedSecrets<SerperOptions, "apiKey">;
```

### Secret Reference Forms

The stored value takes one of three forms, which the configuration UI renders as a source selector:

```yaml
# A literal value, stored in the config file
apiKey: sk-1234

# Read from an environment variable
apiKey:
  source: env
  env: SERPER_API_KEY

# Environment variable with a fallback when the variable (and vault env entry) is unset
baseURL:
  source: env
  env: LLAMA_BASE_URL
  default: http://localhost:11434/v1

# Read from the credential vault
apiKey:
  source: vault
  category: api-keys
  key: serper
```

### Non-Secret Sourced Values

`sourcedValue()` declares a field with the same three sources for values that are not credentials -- a daemon host, an endpoint, an account id. The literal form is shown in plain text and never redacted:

```ts
import { fromEnv, sourcedValue } from "@tokenring-ai/secrets";

host: sourcedValue({ description: "Docker daemon host" }).default(fromEnv("DOCKER_HOST"));
```

## Resolving Secrets

Resolve a secret reference to its actual value at runtime:

```ts
import { resolveSecret, requireSecret } from "@tokenring-ai/secrets";

install(app, config) {
  const apiKey = resolveSecret(app, config.serper.apiKey);
  if (!apiKey) return; // not configured -- the same as an unset environment variable

  registerProvider(new SerperProvider({ ...config.serper, apiKey }));
}
```

- `resolveSecret(app, ref)` returns `undefined` when the secret has no value
- `requireSecret(app, ref, what)` throws a `ConfigurationError` naming the source that came up empty

## API Reference

### Schema Builders

| Export | Description |
| --- | --- |
| `secret(meta?)` | Declares a secret config field. Returns a Zod union of `string \| SecretEnvRef \| SecretVaultRef`. Marked as sensitive for redaction. |
| `sourcedValue(meta?)` | Declares a non-secret sourced field with the same three sources. Not marked as sensitive; literal values are shown in plain text. |

### Reference Helpers

| Export | Description |
| --- | --- |
| `fromEnv(env, default?)` | Creates an environment variable reference, with an optional fallback value. |
| `fromVault(category, key)` | Creates a credential vault reference. |
| `secretSourceOf(value)` | Returns `"value"`, `"env"`, or `"vault"` for a stored secret value. |
| `secretSources` | Tuple of valid source names: `["value", "env", "vault"]`. |
| `describeSecretRef(ref)` | Human-readable description of the secret source, for error messages. |

### Resolution Functions

| Export | Description |
| --- | --- |
| `resolveSecret(app, ref)` | Resolves a secret reference, or `undefined` when unset. |
| `requireSecret(app, ref, what)` | Resolves a secret reference, throwing when it has no value. |

### Types

| Export | Description |
| --- | --- |
| `SecretRef` | Union of `string \| SecretEnvRef \| SecretVaultRef`. |
| `SecretEnvRef` | `{ source: "env", env: string, default?: string }`. |
| `SecretVaultRef` | `{ source: "vault", category: string, key: string }`. |
| `SecretSource` | `"value" \| "env" \| "vault"`. |
| `WithResolvedSecrets<T, K>` | Utility type: `T` with fields `K` resolved to `string`. |
| `SecretStore` | Interface for credential store implementations. |

### Schemas

| Export | Description |
| --- | --- |
| `SecretRefSchema` | Zod union schema for secret references. |
| `SecretEnvRefSchema` | Zod schema for environment variable references. |
| `SecretVaultRefSchema` | Zod schema for vault references. |

## SecretService

The `SecretService` is registered during the plugin's `earlyInstall` hook. It handles all secret resolution and environment lookups.

### Methods

| Method | Description |
| --- | --- |
| `setStore(store)` | Registers the backing store for `{ source: "vault" }` references. |
| `resolve(ref)` | Resolves a reference, or `undefined` when unset. |
| `require(ref, what)` | Resolves a reference, throwing when it has no value. |
| `getEnv(name)` | Reads a named environment value: process environment first, then the vault `env` category. |
| `listEnvNames()` | Returns every environment name readable through `getEnv`. |

### Resolution Order

For `{ source: "env" }` references, resolution follows this order:

1. Process environment variable (`process.env[ref.env]`)
2. Vault entry in the `env` category (`vault/env/<name>`)
3. Optional `default` value on the reference

### SecretStore Interface

Credential stores (such as the vault plugin) implement `SecretStore` and register themselves with the service:

```ts
app.waitForService(SecretService, secretService => secretService.setStore(vaultService));
```

```ts
export interface SecretStore {
  getSecret(category: string, key: string): string | undefined;
  listSecrets(category: string): Record<string, string>;
}
```

The `VAULT_ENV_CATEGORY` constant (`"env"`) identifies the vault category consulted as a fallback for environment variable references.

## Configuration

This package does not define its own configuration schema. It provides the `secret()` and `sourcedValue()` schema builders for other plugins to use in their configuration.

## License

MIT License - see LICENSE file for details.
