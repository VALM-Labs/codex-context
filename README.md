# codex-context

The original **dsh-context** dashboard, adapted into a **VS Code extension for local Codex sessions**.

## Install

Download [codex-context-0.1.0.vsix](https://github.com/VALM-Labs/codex-context/releases/latest/download/codex-context-0.1.0.vsix). In VS Code run **Extensions: Install from VSIX**, select the file, and open the **codex-context** Activity Bar icon.

- The sidebar shows the original context dashboard in a narrow pane.
- **Open Dashboard** in the view title opens the complete page in an editor tab.
- The original token/timing cards, composition, DNA mode, step/turn trends, total/delta views, hover/pin interaction, content browser, events, file activity, and command panel are retained.
- Fleet, Insights, and preferences also use the original components.
- Both surfaces share the selected session. Use the dropdown or **Select Session** to switch.

If the entry is not visible immediately after installation, run **Developer: Reload Window** once VS Code finishes any pending update.

## Source

The VS Code entry is [vscode/](vscode/). It imports the original React components and CSS from [src/client/](src/client/). Its build records SHA-256 provenance for the included upstream files in `dist/upstream-provenance.json` inside the VSIX.

The host changes are a VS Code Webview shell, a local Codex JSONL adapter in a worker thread, branding, and disabled DSH prompt-injection controls. Original DSH instructions remain in [README.upstream.md](README.upstream.md).

## Data and limits

The extension reads local session logs, archived logs, and the title index under `CODEX_HOME` or `~/.codex`. Override the directory using `codex-context.codexHome`. It does not read credentials, upload transcripts, or call a model.

Usage is measured and deduplicated. Composition uses the upstream estimator; occupancy is anchored to the latest recorded request. Visible reasoning summaries and complete recorded text are available on demand. Encrypted reasoning is not exposed.

Missing streaming timings remain unclassified. API-equivalent costs use the bundled models.dev snapshot, not subscription billing. DSH prompt prefix/suffix injection is disabled in this read-only viewer. Compressed `.jsonl.zst` logs are reported as unavailable.

## Build and test

```sh
cd vscode
npm ci
npm run build
npm test
npm run package
```

The VSIX contains its compiled runtime; users do not need Node.js or npm. Tests cover adapter fixtures and original UI interactions. The real VS Code integration entry is `vscode/test-host/index.cjs`.

## License

Original project: [bowenliang123/dsh-context](https://github.com/bowenliang123/dsh-context), Apache-2.0, Copyright 2025 bowenliang123. DeepSeek Harness UI theme and primitives are MIT licensed. See [LICENSE](LICENSE), [vscode/NOTICE](vscode/NOTICE), and [vscode/LICENSE-deepseek-harness](vscode/LICENSE-deepseek-harness).
