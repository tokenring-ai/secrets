import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import TokenRingApp, { PluginManager } from "@tokenring-ai/app";
import buildConfigUISchema from "@tokenring-ai/app/config/buildConfigUISchema";
import { redactSensitiveValues } from "@tokenring-ai/app/config/overrides";
import type { ConfigSecretNode } from "@tokenring-ai/app/config/uiSchema";
import type { TokenRingPlugin } from "@tokenring-ai/app/types";
import { z } from "zod";
import secretsPlugin from "../plugin.ts";
import SecretService, { type SecretStore } from "../SecretService.ts";
import { fromEnv, fromVault, secret, secretSourceOf, sourcedValue } from "../secret.ts";

const pluginConfigSchema = z.object({
  widget: z.object({
    apiKey: secret({ description: "Widget API key" }).default(fromEnv("WIDGET_API_KEY")),
    endpoint: z.string().default("https://example.test"),
  }),
});

const widgetPlugin = {
  name: "widget-plugin",
  displayName: "Widget Plugin",
  version: "1.0.0",
  description: "Widget plugin",
  configSchema: pluginConfigSchema,
} satisfies TokenRingPlugin<typeof pluginConfigSchema>;

describe("secret references", () => {
  describe("schema", () => {
    it("accepts all three sources", () => {
      const schema = secret();
      expect(schema.parse("literal-value")).toBe("literal-value");
      expect(schema.parse({ source: "env", env: "WIDGET_API_KEY" })).toEqual(fromEnv("WIDGET_API_KEY"));
      expect(schema.parse({ source: "vault", category: "env", key: "WIDGET_API_KEY" })).toEqual(fromVault("env", "WIDGET_API_KEY"));
    });

    it("accepts an optional default on env references", () => {
      const schema = secret();
      expect(schema.parse({ source: "env", env: "LLAMA_BASE_URL", default: "http://localhost:11434/v1" })).toEqual(
        fromEnv("LLAMA_BASE_URL", "http://localhost:11434/v1"),
      );
      expect(fromEnv("LLAMA_BASE_URL", "http://localhost:11434/v1")).toEqual({
        source: "env",
        env: "LLAMA_BASE_URL",
        default: "http://localhost:11434/v1",
      });
    });

    it("rejects references missing their target", () => {
      expect(secret().safeParse({ source: "env" }).success).toBe(false);
      expect(secret().safeParse({ source: "vault", category: "env" }).success).toBe(false);
    });

    it("reports the source of a stored value", () => {
      expect(secretSourceOf("literal")).toBe("value");
      expect(secretSourceOf(fromEnv("X"))).toBe("env");
      expect(secretSourceOf(fromVault("env", "X"))).toBe("vault");
    });
  });

  describe("SecretService", () => {
    let service: SecretService;

    beforeEach(() => {
      service = new SecretService();
      delete process.env.TEST_SECRET_VAR;
    });

    afterEach(() => {
      delete process.env.TEST_SECRET_VAR;
    });

    it("resolves a literal value", () => {
      expect(service.resolve("literal-value")).toBe("literal-value");
      expect(service.resolve("")).toBeUndefined();
      expect(service.resolve(undefined)).toBeUndefined();
    });

    it("resolves an environment variable", () => {
      expect(service.resolve(fromEnv("TEST_SECRET_VAR"))).toBeUndefined();
      process.env.TEST_SECRET_VAR = "from-env";
      expect(service.resolve(fromEnv("TEST_SECRET_VAR"))).toBe("from-env");
    });

    it("falls back to a per-ref default when the environment variable is unset", () => {
      expect(service.resolve(fromEnv("TEST_SECRET_VAR", "fallback-value"))).toBe("fallback-value");

      process.env.TEST_SECRET_VAR = "from-env";
      expect(service.resolve(fromEnv("TEST_SECRET_VAR", "fallback-value"))).toBe("from-env");
    });

    it("falls back to the vault env category for unset environment variables", () => {
      service.setStore({
        getSecret: (category: string, key: string) => (category === "env" && key === "TEST_SECRET_VAR" ? "from-vault-env" : undefined),
        listSecrets: (category: string) => (category === "env" ? { TEST_SECRET_VAR: "from-vault-env" } : {}),
      } satisfies SecretStore);

      // Vaults populated while the vault injected its env category still resolve.
      expect(service.resolve(fromEnv("TEST_SECRET_VAR"))).toBe("from-vault-env");

      // Vault wins over a per-ref default.
      expect(service.resolve(fromEnv("TEST_SECRET_VAR", "fallback-value"))).toBe("from-vault-env");

      // A real environment variable still wins.
      process.env.TEST_SECRET_VAR = "from-env";
      expect(service.resolve(fromEnv("TEST_SECRET_VAR"))).toBe("from-env");
    });

    it("resolves a vault entry through the registered store", () => {
      expect(service.resolve(fromVault("env", "WIDGET_API_KEY"))).toBeUndefined();

      service.setStore({
        getSecret: (category: string, key: string) => (category === "env" && key === "WIDGET_API_KEY" ? "from-vault" : undefined),
        listSecrets: () => ({}),
      } satisfies SecretStore);

      expect(service.resolve(fromVault("env", "WIDGET_API_KEY"))).toBe("from-vault");
      expect(service.resolve(fromVault("env", "OTHER"))).toBeUndefined();
    });

    it("names the source when a required secret has no value", () => {
      expect(() => service.require(fromEnv("TEST_SECRET_VAR"), "Widget API key")).toThrow("TEST_SECRET_VAR environment variable");
      expect(() => service.require(fromVault("env", "WIDGET_API_KEY"), "Widget API key")).toThrow("vault entry env/WIDGET_API_KEY");
    });

    it("is registered by the plugin's early install", async () => {
      const app = new TokenRingApp({
        app: {
          workingDirectory: "/tmp",
          workspaceDirectory: "/tmp",
          configDirectories: [],
          shutdownMonitorIntervalMs: 2000,
          serviceRestartDelayMs: 5000,
          printLogs: false,
        },
      });
      expect(app.getService(SecretService)).toBeUndefined();

      await app.addService(new PluginManager(app)).installPlugins([secretsPlugin]);

      expect(app.requireService(SecretService)).toBeInstanceOf(SecretService);
    });
  });

  describe("configuration UI", () => {
    const secretNode = () => {
      const uiSchema = buildConfigUISchema(widgetPlugin)!;
      const widget = uiSchema.slices.widget;
      if (widget?.kind !== "group") throw new Error("expected a group");
      return widget.children.find(child => child.key === "apiKey") as ConfigSecretNode;
    };

    it("introspects a secret into its own node kind, carrying the default source", () => {
      const node = secretNode();
      expect(node.kind).toBe("secret");
      expect(node.defaultValue).toEqual(fromEnv("WIDGET_API_KEY"));
    });

    it("redacts a literal value but passes references through", () => {
      const node = secretNode();
      expect(redactSensitiveValues(node, "super-secret")).toEqual({ __sensitive: true, isSet: true });
      expect(redactSensitiveValues(node, "")).toEqual({ __sensitive: true, isSet: false });
      expect(redactSensitiveValues(node, fromEnv("WIDGET_API_KEY"))).toEqual(fromEnv("WIDGET_API_KEY"));
      expect(redactSensitiveValues(node, fromVault("env", "WIDGET_API_KEY"))).toEqual(fromVault("env", "WIDGET_API_KEY"));
    });

    it("shows a non-sensitive sourced value in plain text", () => {
      const schema = z.object({ widget: z.object({ host: sourcedValue({ description: "Daemon host" }).default(fromEnv("DOCKER_HOST")) }) });
      const uiSchema = buildConfigUISchema({ ...widgetPlugin, configSchema: schema })!;
      const group = uiSchema.slices.widget;
      if (group?.kind !== "group") throw new Error("expected a group");
      const node = group.children.find(child => child.key === "host") as ConfigSecretNode;

      expect(node.kind).toBe("secret");
      expect(node.sensitive).toBe(false);
      expect(redactSensitiveValues(node, "tcp://localhost:2376")).toBe("tcp://localhost:2376");
    });

    it("never leaks a literal secret through a parent group", () => {
      const uiSchema = buildConfigUISchema(widgetPlugin)!;
      const redacted = redactSensitiveValues(uiSchema.slices.widget!, { apiKey: "super-secret", endpoint: "https://example.test" });
      expect(JSON.stringify(redacted)).not.toContain("super-secret");
      expect((redacted as any).endpoint).toBe("https://example.test");
    });
  });
});
