#!/usr/bin/env python3
"""Regenerate web/data.js from web/data/*.json. Run after editing the JSON (it lets the app
load its data under file:///android_asset/ where fetch() is not allowed)."""
import json, pathlib, sys
root = pathlib.Path(__file__).resolve().parent.parent / "web"
faqs = json.loads((root / "data/faqs.json").read_text(encoding="utf-8"))
locs = json.loads((root / "data/locations.json").read_text(encoding="utf-8"))
payload = json.dumps({"faqs": faqs, "locations": locs}, ensure_ascii=False, separators=(",", ":"))
(root / "data.js").write_text("window.CC_DATA=" + payload + ";\n", encoding="utf-8")
print("wrote", root / "data.js", len(payload), "bytes")
