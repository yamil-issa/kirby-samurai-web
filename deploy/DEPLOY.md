# Deploying to a VPS (Ubuntu 24.04)


## 1. First connection & basic hardening

```bash
# Hetzner/Netcup: ssh root@<VPS_IP>
# Oracle: ssh -i your-key.key ubuntu@<VPS_IP>, then prefix root-only commands with sudo

# Create a dedicated non-root user to run the app
adduser samurai-kirby      # (Oracle: sudo adduser samurai-kirby)
usermod -aG sudo samurai-kirby

# Basic firewall: only SSH, HTTP, HTTPS
# (Oracle: also requires opening 80/443 in the Security List — see ORACLE_SETUP.md step 3)
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable
```

## 2. Install Bun (as the samurai-kirby user)

```bash
su - samurai-kirby
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version
which bun   # note this path — you'll need it for the systemd unit below
```

## 3. Install Caddy (reverse proxy + automatic HTTPS)

```bash
# as root / sudo
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

Edit `/etc/caddy/Caddyfile` with the content from `deploy/Caddyfile` in this repo (replace `your-domain.com` with your real domain), then:

```bash
sudo systemctl reload caddy
```

Caddy fetches and renews the Let's Encrypt certificate automatically — nothing else to do here.

## 4. Deploy the code

From your own machine (WSL):

```bash
# adjust the path to wherever your project actually is
rsync -avz --exclude node_modules --exclude dist --exclude .git \
  kirby-samurai/ samurai-kirby@<VPS_IP>:/opt/samurai-kirby/ \
  --rsync-path="sudo rsync"
```

(If `/opt/samurai-kirby` doesn't exist yet or isn't writable, create it first: `sudo mkdir -p /opt/samurai-kirby && sudo chown samurai-kirby:samurai-kirby /opt/samurai-kirby`.)

On the VPS:

```bash
su - samurai-kirby
cd /opt/samurai-kirby

# server/.env — same 3 vars as for local Discord testing, real values
nano server/.env

cd client && bun install && bun run build
cd ../server && bun install
```

## 5. Set up the systemd service

```bash
sudo cp deploy/samurai-kirby.service /etc/systemd/system/
sudo nano /etc/systemd/system/samurai-kirby.service   # fix the ExecStart path to match `which bun` from step 2

sudo systemctl daemon-reload
sudo systemctl enable samurai-kirby
sudo systemctl start samurai-kirby
sudo systemctl status samurai-kirby   # should show "active (running)"
```

## 6. Point Discord at the real domain

In the Developer Portal, **Activities > URL Mappings**: change the target from the cloudflared tunnel URL to your real domain (still no `https://` prefix, just the host). No more tunnel needed from now on.

## 7. Redeploying after code changes

```bash
# from your machine
rsync -avz --exclude node_modules --exclude dist --exclude .git \
  kirby-samurai/ samurai-kirby@<VPS_IP>:/opt/samurai-kirby/ \
  --rsync-path="sudo rsync"

# on the VPS
su - samurai-kirby
cd /opt/samurai-kirby/client && bun run build
sudo systemctl restart samurai-kirby
```

## Troubleshooting

- `sudo systemctl status samurai-kirby` and `sudo journalctl -u samurai-kirby -f` for live logs.
- `sudo systemctl status caddy` / `sudo journalctl -u caddy -f` if HTTPS isn't working — usually a DNS propagation delay (can take a few minutes to a few hours after creating the A record).
- If Discord's proxy can't reach the domain, double check the A record with `dig your-domain.com` from your own machine.
