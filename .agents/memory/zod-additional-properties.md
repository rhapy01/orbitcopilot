---
name: Zod OpenAPI additionalProperties does not mean passthrough
description: Explains why `additionalProperties: true` in an OpenAPI schema does not stop generated zod schemas from stripping unlisted fields at parse time.
---

When defining an OpenAPI object schema for a third-party API response whose exact shape you're reverse-engineering (e.g. via curl), setting `additionalProperties: true` only prevents *validation errors* for unknown keys — it does not make the generated zod schema a passthrough. Orval's zod generation still produces a plain `z.object({...})`, and zod's default behavior is to strip any key not explicitly listed in `properties` when you call `.parse()`.

**Why:** Discovered while proxying a real external API — an endpoint response validated successfully (no zod errors, because of `additionalProperties: true`), but downstream consumers only ever received the handful of properties explicitly declared in the schema. The real fields (e.g. `address`, `token0`, `symbol0`) were silently dropped by `.parse()`, even though the schema was "permissive."

**How to apply:** When building an OpenAPI schema to match a real external response, always inspect the actual live payload (curl it) and explicitly list every field you intend to forward through a route that calls `SomeResponseSchema.parse(result)`. Treat `additionalProperties: true` as "don't error on extra fields," not "let extra fields through."
