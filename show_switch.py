from pathlib import Path
text = Path("web/server/q1-monitor.mjs").read_text(encoding="utf-8-sig")
start = text.index('switch (reason)')
print(text[start:start+400])
