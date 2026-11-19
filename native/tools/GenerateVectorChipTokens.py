#!/usr/bin/env python3
"""W5.3 TokenParity — generate VectorChipTokens.h from Resonance's
src/tokens/designTokens.json (single source of truth).

Writes:  vector chip/native/DSP/VectorChipTokens.h
Requires: no external deps.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]           # "vector chip/"
RESONANCE = Path("C:/Users/Asus/Downloads/ov/SYNTHS/Resonance/src/tokens/designTokens.json")
OUT = ROOT / "native/DSP/VectorChipTokens.h"

def main() -> int:
    tokens = json.loads(RESONANCE.read_text())
    out_lines = [
        "// Auto-generated from Resonance src/tokens/designTokens.json (W5.3 TokenParity)",
        "// Do not edit by hand — regenerate with native/tools/GenerateVectorChipTokens.py",
        "#pragma once",
        "",
        "namespace VectorChipTokens {",
    ]
    faces = tokens.get("faces", {})
    if faces:
        out_lines.append("// Face accent colors (Resonance chassis faces — informational)")
        for face_id, face in faces.items():
            out_lines.append(f"inline constexpr const char* {face_id}Accent = \"{face.get('accent','')}\";")
        out_lines.append("")
    out_lines += ["} // namespace VectorChipTokens", ""]
    OUT.write_text("\n".join(out_lines), encoding="utf-8")
    print(f"wrote {OUT} ({len(out_lines)} lines)")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
