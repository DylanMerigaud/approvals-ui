import { next } from "@dylanmerigaud/config/eslint/next";
import { vitest } from "@dylanmerigaud/config/eslint/vitest";

// Shared config presets (eslint 10 stack): the Next preset (base TS + @eslint-react
// + a11y + Next + perfectionist-sorted imports + the custom rules) and the opt-in
// Vitest rules scoped to test files. See github.com/DylanMerigaud/config.
export default [
  ...next({ tsconfigRootDir: import.meta.dirname }),
  ...vitest(),

  // registry.json is data, not source: it is the shadcn registry manifest. eslint
  // has no business type-checking a JSON file (the typed TS rules crash on it),
  // and prettier already owns its formatting.
  { ignores: ["registry.json", "components.json"] },

  // Repo-local overrides for this shadcn registry.
  //
  // This repo is a shadcn REGISTRY: `shadcn build` packages the files under
  // components/ and lib/approvals-ui/ so other projects install them via
  // `shadcn add`. A distributed component is commonly authored as a default
  // export (that is how a consumer imports a single-component file after
  // `shadcn add`), so allow default exports across the distributed surface.
  {
    files: ["components/**/*.{ts,tsx}", "lib/approvals-ui/**/*.{ts,tsx}"],
    rules: {
      "import-x/no-default-export": "off",
    },
  },

  // no-console-use-logger OFF repo-wide: this repo has no lib/logger.ts (it is a
  // component-library registry, not an app with a logging layer). The rule would
  // push every console call toward a logger that does not exist here.
  {
    rules: {
      "custom/no-console-use-logger": "off",
    },
  },
];
