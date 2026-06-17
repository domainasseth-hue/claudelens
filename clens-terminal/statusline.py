import sys
import json

def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    raw = sys.stdin.read().strip()

    if not raw:
        print("[● MONITORING]  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  0.0%  In: 0 • Out: 0 • Cache: 0")
        sys.stdout.flush()
        return

    try:
        data = json.loads(raw)
        ctx = data.get("context_window", {})

        used_pct = float(ctx.get("used_percentage", 0.0))
        inp      = int(ctx.get("input_tokens", 0))
        out      = int(ctx.get("output_tokens", 0))
        cache    = int(ctx.get("cache_read_input_tokens", 0))
    except Exception:
        print("[● MONITORING]  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  0.0%  In: 0 • Out: 0 • Cache: 0")
        sys.stdout.flush()
        return

    bar_width = 30
    filled = int((max(0.0, min(100.0, used_pct)) / 100.0) * bar_width)
    empty  = bar_width - filled
    bar    = "█" * filled + "░" * empty

    if used_pct >= 95.0:
        color = "\033[91m"
        label = "CRITICAL LIMIT"
    elif used_pct >= 80.0:
        color = "\033[93m"
        label = "CHECKPOINTING"
    else:
        color = "\033[92m"
        label = "MONITORING"

    line = (
        f"{color}[● {label}]\033[0m  "
        f"{bar}  "
        f"{color}{used_pct:.1f}%\033[0m  "
        f"In: {inp:,} • Out: {out:,} • Cache: {cache:,}"
    )

    print(line)
    sys.stdout.flush()

if __name__ == "__main__":
    main()