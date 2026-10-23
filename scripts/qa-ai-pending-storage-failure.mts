// Shares the actual AIChat/server harness and injects only browser IDB failures.
// All accounts, documents, storage and model replies are isolated/synthetic.
process.env.DOCA_QA_MODE = "storage-failure";
process.env.DOCA_QA_PORT ??= "39494";
await import("./qa-ai-pending-refresh.mts");
