/**
 * Jest-only stub for `standardwebhooks`, an optional dependency of
 * @anthropic-ai/sdk's beta webhook-verification resource (which this service
 * never uses). Its transitive dependency @stablelib/base64 ships ESM-only
 * with no CJS build, which Jest's CommonJS test runner can't load. Real
 * (non-test) code still resolves the genuine package.
 */
module.exports = {
  Webhook: class Webhook {},
};
