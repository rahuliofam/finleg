# Remote Access — Hostinger VPS & Alpuca Mac

All credentials are in **Bitwarden**. Any machine with `bw` CLI access can bootstrap itself.

---

## Prerequisites

```bash
# Unlock Bitwarden (macOS keychain auto-unlock)
export BW_SESSION=$(~/bin/bw-unlock)

# If ~/bin/bw-unlock doesn't exist on this machine, unlock manually:
export BW_SESSION=$(bw unlock --raw)
```

---

## Hostinger VPS (Batch Processing Server)

**Bitwarden item:** `Hostinger VPS — OpenClaw Server`

| Field | Value |
|---|---|
| IP | `93.188.164.224` |
| User | `root` |
| Auth | Password only (key auth broken) |
| OS | Ubuntu 24.04, 4 cores, 15 GB RAM, 200 GB disk |
| Domain | `alpaclaw.cloud` (Caddy auto-HTTPS) |
| Software | Node 22+, Claude CLI, wrangler, Docker |

### Connect

```bash
# Pull password from Bitwarden and connect:
export BW_SESSION=$(~/bin/bw-unlock)
HOSTINGER_PASS=$(bw get item "Hostinger VPS — OpenClaw Server" 2>/dev/null | python3 -c "
import sys,json
fields={f['name']:f['value'] for f in json.load(sys.stdin).get('fields',[])}
print(fields.get('Password',''))")

sshpass -p "$HOSTINGER_PASS" ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no root@93.188.164.224
```

### One-time setup (new machine)

```bash
# 1. Install sshpass
brew install esolitos/ipa/sshpass   # macOS
# sudo apt install sshpass          # Linux

# 2. Save password file for convenience (optional)
export BW_SESSION=$(~/bin/bw-unlock)
bw get item "Hostinger VPS — OpenClaw Server" 2>/dev/null | python3 -c "
import sys,json
fields={f['name']:f['value'] for f in json.load(sys.stdin).get('fields',[])}
print(fields.get('Password',''))" > ~/.ssh/alpacapps-hostinger.pass
chmod 600 ~/.ssh/alpacapps-hostinger.pass

# 3. Add SSH config alias (optional)
cat >> ~/.ssh/config << 'EOF'

Host hostinger
  HostName 93.188.164.224
  User root
  PreferredAuthentications password
  PubkeyAuthentication no
EOF

# 4. Test
sshpass -f ~/.ssh/alpacapps-hostinger.pass ssh hostinger 'echo connected'
```

---

## Alpuca Mac (Home Server)

**Bitwarden item:** `Alpuca — Primary Home Server (Mac mini M4)`

| Field | Value |
|---|---|
| Hostname | `Alpuca.local` |
| LAN IP | `192.168.1.200` |
| Tailscale IP | `100.74.59.97` |
| Tailscale hostname | `alpuca` |
| User | `paca` (passwordless sudo) |
| Auth | SSH key (`~/.ssh/id_ed25519`) |
| Hardware | Mac mini M4, 24 GB RAM |

### Connect

```bash
# On same LAN:
ssh paca@192.168.1.200
ssh paca@Alpuca.local

# Over Tailscale (from anywhere):
ssh paca@100.74.59.97
ssh paca@alpuca
```

### One-time setup (new machine)

```bash
# 1. Generate SSH key (if you don't have one)
ssh-keygen -t ed25519

# 2. Copy your key to Alpuca
ssh-copy-id -i ~/.ssh/id_ed25519.pub paca@192.168.1.200

# 3. Add SSH config alias
cat >> ~/.ssh/config << 'EOF'

Host alpuca
  HostName 100.74.59.97
  User paca
  IdentityFile ~/.ssh/id_ed25519
EOF

# 4. Install Tailscale (for remote access outside LAN)
# macOS: brew install tailscale
# Linux: curl -fsSL https://tailscale.com/install.sh | sh
# Then: tailscale login (use alpacaautomatic@gmail.com account)

# 5. Test
ssh alpuca 'echo connected'
```

### Key paths on Alpuca

- **RVAULT20:** `/Volumes/RVAULT20/` — external storage, NOT accessible from other machines
- **Google Takeout:** `/Volumes/RVAULT20/takeout/`
- **Scripts:** `~/scripts/` (nightly-cleanup, screensaver generation, batch thumbnails)
- **rclone remotes:** `gdrive`, `gphotos`, `gdrive-tesloop`

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `No route to host` for Alpuca | Not on same LAN — use Tailscale IP (`100.74.59.97`) instead |
| `Permission denied (publickey)` | Run `ssh-copy-id` to add your key (see setup above) |
| `Permission denied` to Hostinger | Re-pull password from Bitwarden (see connect section) |
| `sshpass: command not found` | `brew install esolitos/ipa/sshpass` (macOS) or `apt install sshpass` (Linux) |
| Hostinger connection timeout | `ping 93.188.164.224` — may be VPS down or firewall issue |
| Tailscale not connecting | Check `tailscale status` — may need `tailscale login` |
