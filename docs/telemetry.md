# Clypra Telemetry

Clypra can optionally upload anonymous performance reports to help improve the app.

## Opt-in

Telemetry upload is **off by default** for all installs, including upgrades.
You must explicitly enable it in Settings → Diagnostics.

To disable it for CI or contributor environments, set:
```
CLYPRA_DISABLE_TELEMETRY_UPLOAD=1
```

## What is collected

Each session report contains only the following fields:
- Session ID (a random UUID generated at session open — not tied to your account or device)
- Frame stage timing percentiles (p50, p95, p99) in microseconds
- GPU adapter name and backend (e.g. "Intel HD 520", "d3d12")
- Preview quality tier and canvas dimensions
- UNCH / skipped-download counts
- App version and git commit SHA

## What is NOT collected
- Project names, file paths, or media content
- User account information
- Hostnames or IP addresses (beyond standard TLS connection metadata)

## Retention

Session reports are retained for **90 days**, after which they are automatically deleted from both object storage and the database.

## Deletion

To request deletion of a session, note the Session ID shown in the Diagnostics tab and contact [support] or open a GitHub issue with the subject "Telemetry deletion request".
