# VS Code port specification

Source: the user's request in this conversation, 2026-11-08.

1. The extension is named `codex-context`. The destination repository is `VALM-Labs/codex-context`.
2. Use the user's fork of `dsh-context`, at upstream revision `dd45d3c6485677f625d8bfbaa0751ef77d5c1879`.
3. Preserve the original statistics pages, visual components, styles, and interactions. Do not deliver a separately redrawn dashboard and call it a complete port.
4. Provide an Activity Bar sidebar and an editor Webview page that the user can open from the extension.
5. Adapt local Codex logs into the original interface contract. Preserve full-session scope, exact measured counters, and access to complete available transcript content on demand.
6. Clearly identify estimates and missing data. Never manufacture missing streaming timings, hidden reasoning text, full prompts, pricing, or account allowance.
7. Preserve upstream source and license attribution. Produce an installable VSIX and verify the real VS Code Webview.
8. The VS Code product surfaces must describe Codex, including the project information card, icon, footer, tooltips, package description, and GitHub About/homepage. Retain source/license attribution; do not present DSH promotions, account links, npm update checks, or unsupported placement/prompt controls as Codex features. Supported Fleet and Insights visibility preferences must control the VS Code tabs.
9. Today/date-filtered cost estimates must price logged GPT-6.1 Sol and Terra using verified model-specific rates, including cached input. Preserve the original snapshot provenance, record supplemental official sources and rate assumptions, and leave unknown models unpriced. Do not change measured usage or the date scope to make a cost appear.
