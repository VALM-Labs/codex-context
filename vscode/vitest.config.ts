import { defineConfig } from 'vitest/config'
export default defineConfig({test:{include:['tests/**/*.test.ts'],environment:'node',testTimeout:30000,coverage:{provider:'v8',include:['src/codex/**/*.ts'],reporter:['text','json-summary']}}})
