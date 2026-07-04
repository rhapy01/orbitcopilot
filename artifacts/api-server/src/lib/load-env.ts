import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load KEY=value pairs from the nearest .env files into process.env
 * (does not override variables already set in the environment).
 * Imported first from index.ts so secrets are available before other modules load.
 */
export function loadEnv(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../.env"),
    resolve(process.cwd(), "../../.env"),
    resolve(process.cwd(), "../../../.env"),
  ];

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      // Bare keys (user pasted only the secret, no KEY=)
      if (!line.includes("=")) {
        if (line.startsWith("sk-or-") || line.startsWith("sk-or-v1-")) {
          if (process.env.OPENROUTER_API_KEY === undefined) {
            process.env.OPENROUTER_API_KEY = line;
          }
        } else if (line.startsWith("sk_") && !line.startsWith("sk-")) {
          // Soroswap-style sk_… (not OpenAI sk-…)
          if (process.env.SOROSWAP_API_KEY === undefined) {
            process.env.SOROSWAP_API_KEY = line;
          }
        } else if (line.startsWith("sk-")) {
          if (process.env.OPENAI_API_KEY === undefined) {
            process.env.OPENAI_API_KEY = line;
          }
        }
        continue;
      }

      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

loadEnv();

