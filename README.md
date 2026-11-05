# pmscan

Polymarket wallet scanner + per-wallet stats.

- Live: https://pmscan.pages.dev
- Scanner list refreshes twice an hour via GitHub Actions
- Wallet stats (`/wallet?w=<address|username>` or `/w/<address|username>`) fetch live Polymarket v2 / gamma data in the browser (with a small `/api/proxy` Pages Function fallback)
