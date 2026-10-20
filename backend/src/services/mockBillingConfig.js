// Production fails closed; the public mock checkout must be explicitly enabled.
// This is a demo simulation and is not a real payment gateway.
export function mockBillingEnabled(env = process.env) {
  if (env.MOCK_BILLING_ENABLED === 'true') return true;
  if (env.MOCK_BILLING_ENABLED === 'false') return false;
  return env.NODE_ENV !== 'production';
}
