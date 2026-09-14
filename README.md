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
- Caddy kontejner s veřejně důvěryhodným wildcard certifikátem přes DuckDNS DNS challenge,
- privátní HTTPS na Tailscale adrese a testovací odpověď pro `*.bench.example.dev`,
- Docker Engine a containerd z oficiálního Docker APT repozitáře,
- Docker Compose plugin,
- externí Docker network `bench-proxy` pro budoucí napojení projektů,
- adresář `~/Sites` pro projekty.

Tailscale poskytuje privátní síťovou cestu ke standardnímu OpenSSH i Caddy.
Tailscale SSH se nezapíná a Docker publikuje porty Caddy pouze na Tailscale
IPv4 adrese. Caddy je připojený do `bench-proxy`, takže na něj později půjde
napojit projektové kontejnery bez publikování jejich portů.
Portless, firewall, exit node, subnet routing, zálohy, správa secrets, Bench
Manager a projektové šablony zatím nejsou součástí repozitáře.

## Požadavky

- Ubuntu Server 24.04 nebo 26.04 LTS,
- uživatel s oprávněním `sudo`,
- připojení k internetu,
- existující Tailscale tailnet,
- jednorázový Tailscale auth key pro připojení nového serveru,
- možnost nastavit DNS záznamy domény použité pro Bench,
- DuckDNS doménu a její account token pro ACME DNS challenge.

Bootstrap ani playbook nespouštějte jako uživatel `root`. Provisioning nastaví
adresář projektů a přístup k Dockeru pro uživatele, který jej spustil.

## Konfigurace

Vytvořte lokální konfiguraci z verzovaného příkladu:

```bash
cp .env.example .env
```

Nastavte v ní unikátní MagicDNS hostname, při prvním spuštění auth key a údaje
pro HTTPS:

```dotenv
TS_HOSTNAME=bench-dev
TS_AUTHKEY=tskey-auth-...
BENCH_DOMAIN=bench.example.dev
DUCKDNS_DOMAIN=example-bench.duckdns.org
DUCKDNS_API_TOKEN=00000000-0000-0000-0000-000000000000
```

`TS_HOSTNAME` je povinný při každém spuštění. `TS_AUTHKEY` je potřeba pouze
pro nový nebo odhlášený server a po úspěšném připojení jej lze z `.env`
odstranit. `BENCH_DOMAIN` je základ wildcard domény. `DUCKDNS_DOMAIN` slouží
pouze jako delegovaný cíl ACME challenge a `DUCKDNS_API_TOKEN` dovoluje Caddy
vytvořit potřebný TXT záznam. Soubor `.env` je ignorovaný Gitem a má syntaxi
Bash přiřazení.

Hodnoty lze předat také přímo. Proměnné z prostředí mají přednost před `.env`:

```bash
TS_HOSTNAME=bench-dev TS_AUTHKEY=tskey-auth-... \
BENCH_DOMAIN=bench.example.dev \
DUCKDNS_DOMAIN=example-bench.duckdns.org \
DUCKDNS_API_TOKEN=00000000-0000-0000-0000-000000000000 \
./bootstrap.sh
```

## DNS konfigurace

Zjistěte Tailscale IPv4 adresu serveru:

```bash
tailscale ip -4
```

Pro výchozí hodnoty z `.env.example` vytvořte u správce DNS dva záznamy:

```text
*.bench.example.dev                 A       <TAILSCALE_IPV4>
_acme-challenge.bench.example.dev   CNAME   example-bench.duckdns.org.
```

První záznam směruje všechny projektové hostname na privátní adresu serveru.
Druhý deleguje pouze ověření certifikátu. DuckDNS se nepoužívá pro směrování
provozu a jeho IP adresa proto není pro Bench podstatná.

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
export ANSIBLE_CONFIG="$PWD/ansible.cfg"
sudo --preserve-env=ANSIBLE_CONFIG,TS_HOSTNAME,TS_AUTHKEY,BENCH_DOMAIN,DUCKDNS_DOMAIN,DUCKDNS_API_TOKEN ansible-playbook \
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
│   │   ├── caddy/
│   │   ├── docker/
│   │   ├── projects/
│   │   └── tailscale/
│   └── playbook.yml
├── .env.example
├── .gitignore
├── AGENTS.md
├── ansible.cfg
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
docker network inspect bench-proxy
docker ps --filter name=bench-caddy
docker exec bench-caddy caddy version
docker exec bench-caddy caddy list-modules | grep '^dns.providers.duckdns$'
test -d "$HOME/Sites"
```

Z jiného zařízení připojeného ke stejnému tailnetu ověřte standardní SSH přes
MagicDNS:

```bash
ssh <user>@bench-dev
```

HTTPS ověřte z libovolného zařízení připojeného ke stejnému tailnetu:

```bash
curl https://test.bench.example.dev
```

Očekávaná odpověď je `Bench Caddy is running`. Dokud nebude přidán Portless,
vrací Caddy stejnou testovací odpověď pro všechny názvy pod wildcard doménou.
