import config from "@iobroker/eslint-config";

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
];
