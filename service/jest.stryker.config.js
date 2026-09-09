// Stryker-only Jest config: identical to package.json's jest block, except
// ts-jest runs transpile-only (isolatedModules), skipping type-checking.
// Stryker re-runs the suite once per mutant (thousands of times); with
// type-checking on, ts-jest re-type-checks the whole dependency graph on
// every run, which is fast enough for a normal `npm test` but makes mutation
// testing CPU-bound on the compiler rather than on the tests themselves,
// causing mutants to time out rather than run. `npm run typecheck` (tsc
// --noEmit) already covers type-checking in preflight, so mutation testing
// doesn't need ts-jest to redo it.
const packageJson = require('./package.json');

module.exports = {
  ...packageJson.jest,
  rootDir: 'src',
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
};
