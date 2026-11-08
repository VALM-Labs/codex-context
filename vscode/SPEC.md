# VS Code port specification

Source: the user's request in this conversation, 2026-11-08.

1. The extension is named `codex-context`. The destination repository is `VALM-Labs/codex-context`.
2. Use the user's fork of `dsh-context`, at upstream revision `dd45d3c6485677f625d8bfbaa0751ef77d5c1879`.
3. Preserve the original statistics pages, visual components, styles, and interactions. Do not deliver a separately redrawn dashboard and call it a complete port.
4. Provide an Activity Bar sidebar and an editor Webview page that the user can open from the extension.
5. Adapt local Codex logs into the original interface contract. Preserve full-session scope, exact measured counters, and access to complete available transcript content on demand.
6. Clearly identify estimates and missing data. Never manufacture missing streaming timings, hidden reasoning text, full prompts, pricing, or account allowance.
7. Preserve upstream source and license attribution. Produce an installable VSIX and verify the real VS Code Webview.
