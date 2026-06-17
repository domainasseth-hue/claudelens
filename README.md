# ClaudeLens

A free, open source Electron desktop app that reads Claude Code's local JSONL session logs and shows real token usage analytics. Zero telemetry. All processing happens on your machine.

## What it does

ClaudeLens scans your `~/.claude/projects/` directory, parses every JSONL session file, and displays a complete analytics dashboard. On first run against a moderately active developer account, you might see numbers like **2.3 billion tokens** consumed across **$1,939** in estimated API costs — spread across multiple projects, with daily burn rates, per-session breakdowns, and live tracking of the currently active session updated every two seconds.

## Why it exists

Claude Code wraps token consumption behind session blocks and `/cost` commands that show only the current session. There is no built-in way to see your total token usage across all projects over time, or to understand which projects drive the most cost. ClaudeLens reads the raw data that already exists on your disk and presents it in a single dashboard.

## Screenshots

![Dashboard](screenshots/dashboard.png)

## Installation

Download the latest installer from [Releases](https://github.com/your-org/claudelens/releases). Run the NSIS installer — it allows you to choose the install directory. The app opens automatically after installation.

## How it works

ClaudeLens reads JSONL files from `~/.claude/projects/` using Node.js filesystem APIs in the Electron main process. Data is sent to the renderer via secure context-bridge IPC. No network requests are made. No analytics are collected. Your session data never leaves your machine.

The renderer is built with plain HTML, CSS, and JavaScript — no React, no Vue, no framework overhead. The only npm dependencies are `electron` and `electron-builder`.

## Data found

Each line in a Claude Code JSONL file is a JSON object. ClaudeLens extracts these fields:

| Field | Source |
|-------|--------|
| `input_tokens` | `message.usage.input_tokens` |
| `output_tokens` | `message.usage.output_tokens` |
| `cache_read_input_tokens` | `message.usage.cache_read_input_tokens` |
| Session start/end time | `timestamp` (root-level, ISO 8601 string) |
| Model identifier | `message.model` (e.g. `claude-sonnet-4-6`) |

Cost estimates use configurable per-model pricing. Defaults: Claude Opus 4 at $15/$75, Sonnet 4 at $3/$15, Haiku 4 at $0.80/$4 (all per million tokens, input/output).

## Settings

- **Model pricing** — Edit the input and output price per million tokens for each model. Saved to localStorage.
- **JSONL path override** — Point ClaudeLens at a different directory if your session logs live elsewhere.

## Building from source

```bash
git clone https://github.com/your-org/claudelens.git
cd claudelens
npm install
npm start
```

Requires Node.js 18+ and npm. To build the Windows installer:

```bash
npm run build
```

Output lands in `dist/`.

## License

MIT