import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

// Official Obsidian plugin-guideline checks — the same rules used by the
// submission portal. Run locally with `npm run lint` to catch issues before
// submitting. See https://github.com/obsidianmd/eslint-plugin for rule docs.
export default defineConfig([
	// Don't lint generated/build artifacts.
	{
		ignores: ["main.js", "main.js.map", "*.zip", "node_modules/"],
	},

	// Obsidian's recommended plugin rules.
	...obsidianmd.configs.recommended,

	// Type-aware parsing for the TypeScript sources.
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
		},
	},

	// Build/config scripts run in Node at build time (not on mobile), so they
	// legitimately import Node built-ins. Relax the mobile-only rule for them.
	{
		files: ["*.mjs"],
		rules: {
			"obsidianmd/no-nodejs-modules": "off",
		},
	},
]);
