import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const dbPackages = [
  { name: "pg", message: "Go through a service in @/server/<module>." },
  { name: "drizzle-orm", message: "Go through a service in @/server/<module>." },
  { name: "@anthropic-ai/sdk", message: "Go through a service in @/server/<module>." },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["src/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server", "@/server/**", "**/server/**"],
              message: "src/ui must not import from @/server.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: dbPackages,
          patterns: [
            {
              group: ["drizzle-orm/*", "pg/*"],
              message: "Go through a service in @/server/<module>.",
            },
            {
              group: ["@/server/db", "@/server/db/**", "**/server/db/**"],
              message: "src/app must not touch the database; use services in @/server/<module>.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".claude/**",
    "dist/**",
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "docs/**",
  ]),
]);

export default eslintConfig;
