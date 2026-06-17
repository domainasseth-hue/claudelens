# ◈ clens — Zero-Token Claude Runtime Telemetry Engine

A lightweight, zero-dependency local CLI utility and real-time status line engine designed specifically to monitor context window consumption and token allocations across Anthropic's Claude toolchains.

## The Core Problem
Running custom model-driven commands or scripts to inspect active session usage naturally appends heavy text data arrays to subsequent conversation turns. This recursive token bloat quickly exhausts your subscription caps and forces premature context compactions.

`clens` provides a dual-architecture solution to monitor your environment.<!-- \\ not true due to arbitrary skill.md structure. -->

---

## Technical Architecture

The suite operates via two completely independent, decoupled entry points:

### 1. Standalone Dashboard Mode (`clens.py`)
A comprehensive, filesystem-driven analysis utility. It scans your local machine cross-platform, locks onto the most recently updated active session log tracking file, and streams the raw byte matrices to calculate long-term historical context accumulation.
* **Target Path:** `~/.claude/projects/**/*.jsonl`
* **Ceiling Threshold:** 3,000,000 tokens

### 2. Live Native HUD Mode (`statusline.py`)
A stateless, zero-token background process that hooks straight into the Claude Code terminal lifecycle loop. Instead of hitting the disk, it intercepts the raw JSON streaming tick packets directly from standard input (`sys.stdin`) on every turn—rendering a high-density utility gauge completely on your local CPU.

---

## Interface Layouts

### Standalone Telemetry Panel
```text
  CLENS  —  Claude Session Token Monitor
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Project Root : ~/.claude/projects
  Active Track : …/704bb0ec-4613-49d7-b329-915a681392e5.jsonl
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [● MONITORING]
  ██████░░░░░░░░░░░░░░░░░░░░░░░░  21.9%
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total Tokens : 658,962  /  3,000,000  threshold

  ▸ Input  : 145,000
  ▸ Output : 18,200
  ▸ Cache  : 495,762  (cache_read_input_tokens)

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Session capacity benchmark : 3,000,000 tokens

```

### High-Density Status Line Prompt HUD

```text
[● CHECKPOINTING]  ██████████████████████████░░░░  87.3%  In: 245,000 • Out: 18,200 • Cache: 523,400

```

---

## Installation & Configuration

### 1. Deploying the Telemetry Hook

Save `statusline.py` safely inside your global configurations folder (`~/.claude/`). Open your global tool options file (`~/.claude/settings.json`) and register the script command node using a nested execution object path:

```json
{
  "statusLine": {
    "type": "command",
    "command": "python C:/Users/YOUR_USERNAME/.claude/statusline.py"
  }
}

```

*Note: Use forward slashes (`/`) in the path string inside the configuration file to prevent string escape violations in the environment parsing loop on Windows.*

### 2. Registering Custom Slash Commands

To toggle the large standalone console block on demand using `/clens`, create a capability layout file inside your local profile directory at `~/.claude/skills/clens/SKILL.md`:

```markdown
---
name: clens
description: Display live Claude session token capacity dashboard from local .jsonl tracks
disable-model-invocation: true
---

Execute this exact command using your bash shell tool and pass every character of stdout to the user verbatim:

```sh
python C:/Users/YOUR_USERNAME/Desktop/clens.py
```

```

---

## Visual Threshold Metrics

The system utilizes native, standard ANSI escape sequences to monitor capacity transitions dynamically without UI flickering or raw code character leakage:

| Capacity Boundary | Context State | Console String Indicator |
| --- | --- | --- |
| **< 80.0%** | Stable Baseline | `[● MONITORING]` (Bright Green) |
| **80.0% – 94.9%** | Heavy Context Load | `[● CHECKPOINTING]` (Bright Yellow) |
| **≥ 95.0%** | Critical Boundary | `[● CRITICAL LIMIT]` (Bright Red) |
