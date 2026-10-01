import config from "@ledgerhq/eslint-config-dsdk";

export default [
  ...config,
  {
    ignores: ["eslint.config.mjs", "vitest.config.mjs", "lib/**"],
    languageOptions: { parserOptions: { project: "./tsconfig.json" } },
  },
  {
    files: ["src/state-machine.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];
