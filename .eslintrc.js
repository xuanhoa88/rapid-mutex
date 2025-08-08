module.exports = {
  env: {
    browser: false,
    node: true,
    commonjs: true,
    es6: true, // Updated to support modern JavaScript
  },
  extends: ['eslint:recommended', 'plugin:prettier/recommended'], // Includes Prettier as part of linting
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest', // Using the latest ECMAScript version
    sourceType: 'module', // Use ES Modules
    ecmaFeatures: {
      modules: true, // Explicitly allow modules
    },
  },
  rules: {
    // General rules
    'no-console': 'warn', // Warn for console logs
    'no-shadow': 'warn', // Warn for shadowed variables
    'no-param-reassign': 'off', // Allow parameter reassignment
    'no-var-requires': 'off', // Allow require statements for CommonJS
    'no-unused-vars': [
      'warn',
      {
        vars: 'all',
        varsIgnorePattern: '^_', // Allow unused vars prefixed with "_"
        args: 'after-used',
        argsIgnorePattern: '^_', // Allow unused args prefixed with "_"
      },
    ],

    // Deprecated or redundant rules
    'explicit-function-return-type': 'off', // Not applicable in JavaScript
    'explicit-module-boundary-types': 'off', // Not relevant without TypeScript

    // Prettier integration
    'prettier/prettier': 'error', // Enforce Prettier formatting
  },
};
