export default {
  testDir: './test/e2e',
  testMatch: '**/*.test.ts',
  timeout: 30000,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  outputDir: './test-results',
  use: { trace: 'on-first-retry', screenshot: 'only-on-failure' },
}
