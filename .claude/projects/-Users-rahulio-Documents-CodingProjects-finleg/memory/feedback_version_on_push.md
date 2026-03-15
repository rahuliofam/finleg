---
name: Report version and URL on push
description: Always report the version string (from version.json) and the public URL (finleg.net) after pushing code
type: feedback
---

When pushing code, always:
1. Read `version.json` and report the version string
2. Include the public URL as a clickable link: https://finleg.net
3. Always use clickable URLs (with https:// prefix), never just plain text domain names
4. Do NOT include test/preview URLs if the code has not been pushed yet
