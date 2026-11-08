# codex-context

The original **dsh-context** React interface and styles, hosted directly in a VS Code Webview and connected to local Codex session logs.

Open the **codex-context** Activity Bar icon for the sidebar. Use **Open Dashboard** in its title bar, or run `codex-context: Open Dashboard`, for the complete editor page. Both surfaces share the selected Codex session.

The original context dashboard, DNA mode, step/turn trends, delta mode, content browser, events, file activity, command panel, Fleet view, Insights page, and preferences are imported from `../src/client`. They are not recreated with a second chart implementation. Product copy, the project card, and icons describe Codex. DSH balance and npm update lookups, placement, and prompt-injection controls are omitted; supported tab visibility preferences work in VS Code.

## Data

The extension reads `CODEX_HOME`, or `~/.codex`, on the machine running its extension host. Set `codex-context.codexHome` to override it. It reads session and archived-session JSONL files and the title index, never credentials. Parsing runs in a worker thread. Nothing is uploaded and no model requests are made.

Codex cumulative usage is measured and deduplicated. Content composition uses the upstream estimator; the latest request is the context-occupancy anchor. Hidden reasoning text, complete assembled requests, and unrecorded streaming timings cannot be reconstructed from logs. The interface identifies these limits. Estimated API costs, when a model price is available, are not subscription bills. Compressed `.jsonl.zst` histories are currently reported as unavailable.

## Build

```sh
npm install
npm run build
npm test
npm run package
```

Install the generated `codex-context-0.1.1.vsix` using **Extensions: Install from VSIX**. Run **Developer: Reload Window** after upgrading an already open dashboard.

Original source: https://github.com/bowenliang123/dsh-context

VS Code adaptation: https://github.com/VALM-Labs/codex-context

Apache-2.0. Original author and license are retained.
