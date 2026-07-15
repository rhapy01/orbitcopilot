/**
 * Root pointer for Stellar / Soroban integration discovery.
 * Implementation lives in the frontend + API (TypeScript).
 *
 * Frontend SDK: artifacts/orbit-copilot/src/lib/soroban.ts
 * Contract map: artifacts/orbit-copilot/src/lib/contract.ts
 * API builder:  artifacts/api-server/src/lib/onchain.ts
 * Cross-check:  contracts/INTEGRATION.md
 * CI/CD:        .github/workflows/ci.yml , .github/workflows/cd.yml
 */
module.exports = {
  frontendSoroban: "artifacts/orbit-copilot/src/lib/soroban.ts",
  frontendContracts: "artifacts/orbit-copilot/src/lib/contract.ts",
  apiOnchain: "artifacts/api-server/src/lib/onchain.ts",
  integrationDoc: "contracts/INTEGRATION.md",
  ci: ".github/workflows/ci.yml",
  cd: ".github/workflows/cd.yml",
};
