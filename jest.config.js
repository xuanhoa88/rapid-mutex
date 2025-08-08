module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.spec.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/**/*.test.js', '!src/**/*.spec.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // ES modules are now properly supported
  // Add ES module support through transform
  transform: {
    '^.+\\.[tj]s$': 'ts-jest',
  },

  // Mock settings
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};
