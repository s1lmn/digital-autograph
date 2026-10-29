// Persisted engineering admission caps; not pricing or eligibility policy.
export const autographResourceLimits = {
  owned: 100,
  createsPerHour: 20,
  globalCreatesPerHour: 2000,
  pending: 3,
  globalPending: 300,
  retiredKeyBudget: 10000,
  parallelIo: 4,
  uploadAttempts: 5,
} as const;
