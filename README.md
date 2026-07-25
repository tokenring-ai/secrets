# @tokenring-ai/secrets

Configuration secrets for TokenRing plugins: API keys, tokens and passwords are declared in a plugin's config
schema, and the **user** decides where each value actually comes from.

Plugins never read `process.env` themselves.

## Declaring a secret

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

The stored value takes one of three forms, which the configuration UI renders as a source selector:

```yaml
# a literal value, stored in the config file
apiKey: sk-1234

# read from an environment variable
apiKey:
  source: env
  env: SERPER_API_KEY

# env with a fallback when the variable (and vault env entry) is unset
baseURL:
  source: env
  env: LLAMA_BASE_URL
  default: http://localhost:11434/v1

# read from the credential vault
apiKey:
  source: vault
  category: api-keys
  key: serper
```

Resolution order for `{ source: env }` is: process environment → vault `env` category → optional `default` on the ref.

## Resolving a secret

```ts
import { resolveSecret, requireSecret } from "@tokenring-ai/secrets";

install(app, config) {
  const apiKey = resolveSecret(app, config.serper.apiKey);
  if (!apiKey) return; // not configured — the same as an unset environment variable

  registerProvider(new SerperProvider({ ...config.serper, apiKey }));
}
```

`resolveSecret` returns undefined when the secret has no value; `requireSecret(app, ref, what)` throws an error
naming the source that came up empty.

## Installation

The plugin must be installed before any plugin that declares a secret — resolving one without it raises
"SecretService not found":

```ts
import SecretsPlugin from "@tokenring-ai/secrets/plugin";

export const plugins = [SecretsPlugin, ...otherPlugins];
```

## Credential stores

`{ source: "vault" }` references resolve through a `SecretStore` registered on the service. The vault plugin
registers itself during its early install:

```ts
app.waitForService(SecretService, secretService => secretService.setStore(vaultService));
```

For compatibility with vaults populated while the vault injected its `env` category into `process.env`, an
`{ source: "env" }` reference falls back to the vault entry of the same name in the `env` category when the
environment variable is not set. `getEnv`/`listEnvNames` expose the same lookup for code that needs to read a named environment value directly
rather than through a declared config field.

## Non-secret sourced values

`sourcedValue()` declares a field with the same three sources for values that are not credentials — a daemon
host, an endpoint, an account id. The literal form is shown in plain text and never redacted:

```ts
host: sourcedValue({ description: "Docker daemon host" }).default(fromEnv("DOCKER_HOST"));
```
