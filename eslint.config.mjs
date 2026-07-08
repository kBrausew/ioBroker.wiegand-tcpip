import config from "@iobroker/eslint-config";
import globals from "globals";

export default [
  ...config,
  {
    // Adapter-specific ignores (replaces .eslintignore)
    ignores: [
      "node_modules/**",
      "test/**",
      "admin/**",
      "gulpfile.js",
      "**/*.d.ts",
    ],
  },
  {
    files: ["**/*.test.js", "test/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.mocha,
        ...globals.node,
      },
    },
  },
];
