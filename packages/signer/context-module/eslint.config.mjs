import config from "@ledgerhq/eslint-config-dsdk";

const importRule = config.findLast(
  (entry) => entry.rules?.["no-restricted-imports"],
).rules["no-restricted-imports"];

export default [
  ...config,
  {
    ignores: ["eslint.config.mjs", "vitest.*.mjs", "scripts/*.mjs", "lib/*"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
  },
  {
    files: ["src/shared/utils/ethereumBuffer.ts"],
    rules: {
      "no-restricted-imports": [
        importRule[0],
        {
          ...importRule[1],
          patterns: [...importRule[1].patterns, "!buffer/index.js"],
        },
      ],
    },
  },
];
