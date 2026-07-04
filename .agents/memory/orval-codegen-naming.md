---
name: Orval codegen response/body naming collisions
description: How to avoid TS2308 duplicate export errors when adding custom OpenAPI schemas alongside orval-generated Body/Response types.
---

Orval auto-derives TypeScript type names for request/response bodies from the operationId, in the pattern `<PascalCaseOperationId>Body` / `<PascalCaseOperationId>Response`. If you also define a custom named schema in `components/schemas` that happens to match one of these auto-derived names exactly, codegen emits two conflicting exports with the same name, causing `TS2308: Module already exports a member named 'X'`.

**Why:** Hit this while adding new OpenAPI paths — a custom schema meant to describe a transaction-building response collided with an operation's auto-derived `<Op>Response` name.

**How to apply:** When adding new custom schemas that are referenced via `$ref` inside a path's request/response body, give them names that would never coincidentally match `<OperationId>Body`/`<OperationId>Response` for any operationId in the spec (e.g. prefix with a feature namespace like `SteldexTxResult` rather than a generic `TxResult`/`BuildTransactionResponse`). Custom schemas used purely as $ref targets for shared shapes are safe; the risk is only when the name exactly matches the auto-derived pattern.
