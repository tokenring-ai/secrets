import type TokenRingApp from "@tokenring-ai/app";
import { ConfigurationError, type TokenRingService } from "@tokenring-ai/app/types";
import { describeSecretRef, type SecretRef } from "./secret.ts";

/**
 * A store of named credentials the resolver can read `{ source: "vault" }`
 * references from. Implemented by the vault plugin's VaultService; registered
 * during its early install so plugins can resolve secrets from their own
 * install hook.
 */
export interface SecretStore {
  getSecret(category: string, key: string): string | undefined;
  /** Every entry in a category, or an empty object when locked or absent. */
  listSecrets(category: string): Record<string, string>;
}

/**
 * Vault category consulted when an environment variable is not set.
 *
 * The vault used to publish this category into `process.env` at startup, so
 * every credential stored there was reachable as an environment variable.
 * Injection is gone — nothing is written into the process environment any more —
 * but an `{ source: "env" }` reference still falls back to the entry of the same
 * name here, so vaults populated under the old behaviour keep working.
 */
export const VAULT_ENV_CATEGORY = "env";

/**
 * Resolves configuration secret references to their values.
 *
 * Registered on every {@link TokenRingApp}, so plugins can always resolve a
 * secret without the host having to wire anything up. Environment lookups are
 * handled here — this is the only place in the app that reads `process.env` for
 * configuration values, so which variable (if any) a secret comes from stays a
 * user configuration choice.
 */
export default class SecretService implements TokenRingService {
  readonly name = "SecretService";
  readonly description = "Resolves configuration secrets from the environment or the credential vault";

  private store: SecretStore | undefined;

  /** Registers the backing store for `{ source: "vault" }` references. */
  setStore(store: SecretStore): void {
    this.store = store;
  }

  /** Resolves a reference, or undefined when it is unset or has no value. */
  resolve(ref: SecretRef | undefined): string | undefined {
    if (ref === undefined) return undefined;
    if (typeof ref === "string") return ref === "" ? undefined : ref;
    if (ref.source === "env") {
      return process.env[ref.env] || this.store?.getSecret(VAULT_ENV_CATEGORY, ref.env) || ref.default || undefined;
    }
    return this.store?.getSecret(ref.category, ref.key) || undefined;
  }

  /**
   * Reads a named environment value: the process environment first, then the
   * vault's env category. Use this instead of `process.env` so vault-stored
   * values remain reachable now that the vault no longer injects them.
   */
  getEnv(name: string): string | undefined {
    return process.env[name] || this.store?.getSecret(VAULT_ENV_CATEGORY, name) || undefined;
  }

  /** Resolves a reference, throwing a message naming the source when it has no value. */
  require(ref: SecretRef | undefined, what: string): string {
    const value = this.resolve(ref);
    if (value === undefined) {
      throw new ConfigurationError(this.name, `${what} is not set: no value found in ${describeSecretRef(ref)}`);
    }
    return value;
  }
}

/** Resolves a configuration secret, or undefined when it is unset or has no value. */
export function resolveSecret(app: TokenRingApp, ref: SecretRef | undefined): string | undefined {
  return app.requireService(SecretService).resolve(ref);
}

/** Resolves a configuration secret, throwing when it has no value. */
export function requireSecret(app: TokenRingApp, ref: SecretRef | undefined, what: string): string {
  return app.requireService(SecretService).require(ref, what);
}
