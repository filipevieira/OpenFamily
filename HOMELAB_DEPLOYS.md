# Homelab Deployment Guidelines & Best Practices

## Server Environment
- **Host**: Proxmox VE node (`192.168.1.100`)
- **LXC Container**: `ct-ubuntu-docker` (VMID `100`, IP `192.168.1.101`)
- **Port Mappings**:
  - `openfamily-client`: `3300:80`
  - `openfamily-server`: `3301:3001`
  - `openfamily-db`: `5432:5432`
- **Reverse Proxy / Cloudflare Tunnel**:
  - `cloudflared-tunnel` runs as a Portainer stack in `/var/lib/docker/volumes/portainer_data/_data/compose/1` on `192.168.1.101`.
  - Public Domain: `https://familia.fvds.dev/`

## ⚠️ STRICT RULE FOR DOCKER OPERATIONS ON THIS HOMELAB
**NEVER run global Docker cleanup commands like `docker rm -f $(docker ps -aq)` or `docker stop $(docker ps -q)` on `192.168.1.101`!**

Doing so will accidentally stop Portainer stacks, including `cloudflared-tunnel` (Stack 1), causing Error 1033 on Cloudflare.

### Safe Deployment & Container Restart Commands:
To rebuild or restart OpenFamily containers safely without affecting other services:

```bash
# 1. Target strictly OpenFamily containers by name
docker rm -f openfamily-server openfamily-client openfamily-db

# 2. Rebuild and restart only OpenFamily stack
cd /opt/stacks/OpenFamily
docker-compose up -d --build
```
