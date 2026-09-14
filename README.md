# Bench

Bench je reprodukovatelný headless Ubuntu server pro vývoj webových projektů.
Tento repozitář obsahuje pouze infrastrukturu a provisioning serveru; webová
administrace bude žít v samostatném repozitáři.

## Aktuální rozsah

Provisioning podporuje čistou instalaci Ubuntu Server 24.04 nebo 26.04 LTS na
architekturách AMD64 a ARM64. Nainstaluje a nastaví:

- základní balíčky `ca-certificates` a `curl`,
- Git,
- Tailscale a připojení serveru k existujícímu tailnetu,
- Docker Engine a containerd z oficiálního Docker APT repozitáře,
- Docker Compose plugin,
- adresář `~/Sites` pro projekty.

Tailscale poskytuje privátní síťovou cestu ke standardnímu OpenSSH. Tailscale
SSH se nezapíná. Caddy, Portless, firewall, exit node, subnet routing, zálohy,
správa secrets, Bench Manager a projektové šablony zatím nejsou součástí
repozitáře.

## Požadavky

- Ubuntu Server 24.04 nebo 26.04 LTS,
- uživatel s oprávněním `sudo`,
- připojení k internetu,
- existující Tailscale tailnet,
- jednorázový Tailscale auth key pro připojení nového serveru.

Bootstrap ani playbook nespouštějte jako uživatel `root`. Provisioning nastaví
adresář projektů a přístup k Dockeru pro uživatele, který jej spustil.

## Konfigurace

Vytvořte lokální konfiguraci z verzovaného příkladu:

```bash
cp .env.example .env
```

Nastavte v ní unikátní MagicDNS hostname a při prvním spuštění také auth key:

```dotenv
TS_HOSTNAME=bench-dev
TS_AUTHKEY=tskey-auth-...
```

`TS_HOSTNAME` je povinný při každém spuštění. `TS_AUTHKEY` je potřeba pouze
pro nový nebo odhlášený server a po úspěšném připojení jej lze z `.env`
odstranit. Soubor `.env` je ignorovaný Gitem a má syntaxi Bash přiřazení.

Hodnoty lze předat také přímo. Proměnné z prostředí mají přednost před `.env`:

```bash
TS_HOSTNAME=bench-dev TS_AUTHKEY=tskey-auth-... ./bootstrap.sh
```

## Instalace

```bash
git clone git@github.com:youngmedia/bench.git
cd bench
cp .env.example .env
# Doplňte .env.
./bootstrap.sh
```

`bootstrap.sh` načte konfiguraci, nainstaluje pouze `ansible-core` a spustí
lokální playbook. Ansible si při běhu vyžádá heslo pro `sudo`.

Po dokončení se odhlaste a znovu přihlaste, aby se projevilo členství ve
skupině `docker`.

## Přímé spuštění Ansible

Pokud už je Ansible nainstalovaný, lze provisioning spustit přímo:

```bash
set -a
source .env
set +a
sudo --preserve-env=TS_HOSTNAME,TS_AUTHKEY ansible-playbook \
  --inventory ansible/inventory/hosts.yml \
  ansible/playbook.yml
```

Playbook je idempotentní. Připojený server při dalších bězích auth key
nepotřebuje; změna `TS_HOSTNAME` aktualizuje jeho Tailscale hostname.

## Struktura repozitáře

```text
.
├── ansible/
│   ├── inventory/
│   │   └── hosts.yml
│   ├── roles/
│   │   ├── base/
│   │   ├── docker/
│   │   ├── projects/
│   │   └── tailscale/
│   └── playbook.yml
├── .env.example
├── .gitignore
├── AGENTS.md
├── bootstrap.sh
└── README.md
```

## Ověření instalace

Po novém přihlášení lze instalaci ověřit:

```bash
git --version
tailscale status
docker --version
docker compose version
docker run --rm hello-world
test -d "$HOME/Sites"
```

Z jiného zařízení připojeného ke stejnému tailnetu ověřte standardní SSH přes
MagicDNS:

```bash
ssh <user>@bench-dev
```
