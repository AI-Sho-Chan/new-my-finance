from pathlib import Path
path = Path("web/server/q1-monitor.mjs")
text = path.read_text(encoding="utf-8")
old = "      lastJPScanKey: null,\r\n      lastUSScanKey: null,\r\n      lastJPScanAt: null,\r\n      lastUSScanAt: null,\r\n      snapshotByMarket: { JP: null, US: null },\r\n    };"
new = "      lastJPScanKey: null,\r\n      lastUSScanKey: null,\r\n      lastGlobalScanKey: null,\r\n      lastUSSectorScanKey: null,\r\n      lastJPSectorScanKey: null,\r\n      lastAllScanKey: null,\r\n      lastJPScanAt: null,\r\n      lastUSScanAt: null,\r\n      lastGlobalScanAt: null,\r\n      lastUSSectorScanAt: null,\r\n      lastJPSectorScanAt: null,\r\n      lastAllScanAt: null,\r\n      snapshotByMarket: { JP: null, US: null },\r\n      snapshotByCategory: {},\r\n    };"
if old not in text:
    raise SystemExit('default state block not found')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
