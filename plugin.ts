import type { TokenRingPlugin } from "@tokenring-ai/app";
import packageJSON from "./package.json" with { type: "json" };
import SecretService from "./SecretService.ts";

/**
 * Registers the secret resolver during early install, so plugins can resolve
 * their configured secrets from their own install hook, and so credential
 * stores (the vault) have something to register with before anything reads a
 * secret.
 *
 * Install this plugin before any plugin that declares a `secret()` config
 * field — resolving one without it raises "SecretService not found".
 */
export default {
  name: packageJSON.name,
  displayName: "Secrets",
  version: packageJSON.version,
  description: packageJSON.description,
  earlyInstall(app) {
    app.addServices(new SecretService());
  },
} satisfies TokenRingPlugin;
