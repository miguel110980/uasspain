"""Regenerate Latin WOFF2 subsets; requires fonttools[woff] and brotli.

Original fonts remain available as fallback. Preserve outlines, metrics,
variable weights, layout features, and all Spanish characters.
"""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

folder = Path(__file__).resolve().parent.parent / "public" / "fonts"
ranges = "0000-00FF,0131,0152-0153,02BB-02BC,02C6,02DA,02DC,0304,0308,0329,2000-206F,2074,20AC,2122,2191,2193,2212,2215,FEFF,FFFD"
for name in ("inter", "space-grotesk", "jetbrains-mono"):
    font = TTFont(folder / f"{name}.woff2", recalcTimestamp=False)
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    generator = subset.Subsetter(options=options)
    generator.populate(unicodes=subset.parse_unicodes(ranges))
    generator.subset(font)
    font.flavor = "woff2"
    target = folder / f"{name}-latin.woff2"
    font.save(target)
    print(f"{target.name}: {target.stat().st_size} bytes")
    if name in ("space-grotesk", "jetbrains-mono"):
        weight = 700 if name == "space-grotesk" else 400
        fixed = instantiateVariableFont(font, {"wght": weight}, inplace=False)
        fixed.flavor = "woff2"
        target = folder / f"{name}-latin-{'bold' if weight == 700 else 'regular'}.woff2"
        fixed.save(target)
        print(f"{target.name}: {target.stat().st_size} bytes")

# The first viewport only needs ASCII, Spanish accents and common punctuation.
# Keep the broader Latin and original fonts as fallbacks for every other glyph.
critical = "0020,0025-003A,0040-005A,0061-007A,00A1,00A9,00B0,00B7,00BF,00C1,00C9,00CD,00D1,00D3,00DA,00DC,00E1,00E9,00ED,00F1,00F3,00FA,00FC,2013,2014,2018,2019,201C,201D,2026,20AC"
for name, weight in (("inter", (300, 700)), ("space-grotesk", (600, 700)), ("jetbrains-mono", 400)):
    font = TTFont(folder / f"{name}.woff2", recalcTimestamp=False)
    generator = subset.Subsetter(options=options)
    generator.populate(unicodes=subset.parse_unicodes(critical))
    generator.subset(font)
    font = instantiateVariableFont(font, {"wght": weight}, inplace=True)
    font.flavor = "woff2"
    target = folder / f"{name}-critical.woff2"
    font.save(target)
    print(f"{target.name}: {target.stat().st_size} bytes")
