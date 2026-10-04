// Fail closed until the corresponding user flows are implemented and reviewed.
// These are release capabilities, not authorization or client-configurable flags.
export const frontendCapabilities = {
  paidTakeover: false,
  creatorDashboard: false,
  notifications: false,
} as const;
