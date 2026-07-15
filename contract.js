/**
 * Root pointer for contract ↔ frontend method matching.
 *
 * Frontend registry: artifacts/orbit-copilot/src/lib/contract.ts
 * Frontend SDK:      artifacts/orbit-copilot/src/lib/soroban.ts (uses @stellar/stellar-sdk)
 * API tx builder:    artifacts/api-server/src/lib/onchain.ts
 * Cross-check doc:   contracts/INTEGRATION.md
 * CI / CD:           .github/workflows/ci.yml , .github/workflows/cd.yml
 */
module.exports = {
  frontendContracts: "artifacts/orbit-copilot/src/lib/contract.ts",
  frontendSoroban: "artifacts/orbit-copilot/src/lib/soroban.ts",
  apiOnchain: "artifacts/api-server/src/lib/onchain.ts",
  integrationDoc: "contracts/INTEGRATION.md",
  ci: ".github/workflows/ci.yml",
  cd: ".github/workflows/cd.yml",
};
