import { config } from "@workspace/eslint-config/base"

export default [
  ...config,
  {
    files: ["src/**/*.ts", "tests/**/*.js"],
    languageOptions: {
      globals: {
        global: "readonly",
        Headers: "readonly",
        process: "readonly",
        Buffer: "readonly",
        console: "readonly",
        fetch: "readonly",
        Response: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        AbortSignal: "readonly",
        DOMException: "readonly",
        setTimeout: "readonly",
      },
    },
    rules: { "turbo/no-undeclared-env-vars": "off" },
  },
  {
    files: ["src/**/*.ts"],
    // TypeScript checks names and unused declarations; the shared Babel parser cannot track type references.
    rules: { "no-undef": "off", "no-unused-vars": "off" },
  },
]
