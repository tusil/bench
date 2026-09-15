# Bench

Bench je reprodukovatelný headless Ubuntu server pro vývoj webových projektů.
Repozitář obsahuje infrastrukturu, provisioning, CLI a webovou administraci
serveru.

## Aktuální rozsah

Provisioning podporuje čistou instalaci Ubuntu Server 24.04 nebo 26.04 LTS na
architekturách AMD64 a ARM64. Nainstaluje a nastaví:

- základní balíčky `ca-certificates` a `curl`,
- Git,
- Bubblewrap a cílený AppArmor profil pro Codex sandbox,
- Tailscale a připojení serveru k existujícímu tailnetu,
- Caddy kontejner s veřejně důvěryhodným wildcard certifikátem přes DuckDNS DNS challenge,
- privátní HTTPS na Tailscale adrese a stavovou stránku pro vypnuté projekty,
- Docker Engine a containerd z oficiálního Docker APT repozitáře,
- Docker Compose plugin,
- externí Docker network `bench-proxy` pro budoucí napojení projektů,
- TypeScript CLI `bench` pro spouštění a HTTPS zpřístupnění projektů,
- Nuxt Bench Manager pro přehled, spouštění a zastavování projektů,
- výchozí adresář `~/Projects` pro projekty.

Tailscale poskytuje privátní síťovou cestu ke standardnímu OpenSSH i Caddy.
Tailscale SSH se nezapíná a Docker publikuje porty Caddy pouze na Tailscale
IPv4 adrese. Caddy je připojený do `bench-proxy`, takže na něj později půjde
napojit projektové kontejnery bez publikování jejich portů.
Portless, firewall, exit node, subnet routing, zálohy, správa secrets a
projektové šablony zatím nejsou součástí repozitáře.

## Integrace projektu

V kořeni projektu si nechte vytvořit základní `bench.yml`:

```bash
bench init
```

Příkaz odvodí `name` z názvu aktuálního adresáře a existující `bench.yml`
nepřepíše. Vygenerovanou službu a port upravte podle Compose projektu:

```yaml
name: operon

routes:
  - service: frontend
    port: 3000

  - domain: api-operon.bench.example.dev
    service: backend
    port: 3333
```

Potom lze projekt spustit a zastavit:

```bash
bench up
bench down
```

Výchozí příkazy jsou `docker compose up -d` a `docker compose down`. Projekt
s vlastními skripty může nastavit všechny potřebné příkazy:

```yaml
commands:
  compose: docker compose -f compose.dev.yml --profile dev
  up: npm run docker:dev:up
  down: npm run docker:dev:down
```

`commands.compose` musí ukazovat na stejný Compose projekt jako vlastní
`up`/`down`, protože přes něj Bench ověřuje služby a hledá kontejnery.

Logy všech služeb aktuálního Compose projektu lze vypsat jednorázově nebo
průběžně:

```bash
bench logs --tail 200 --follow
```

Route domény musí být přímo pod `bench.example.dev`, protože TLS certifikát
je vystavený pro `*.bench.example.dev`. Použijte proto například
`api-operon.bench.example.dev`, ne `api.operon.bench.example.dev`.

## Bench Manager

Manager je po provisioningu dostupný pouze z tailnetu na
`https://bench.example.dev`. Zobrazuje přímé podadresáře nakonfigurovaného
adresáře projektů, které obsahují `bench.yml`, jejich routy a stav. Projekty lze
z rozhraní spustit, zastavit a otevřít jejich logy na samostatné stránce.

Dashboard každých pět sekund obnovuje aktuální využití CPU, RAM, swapu a
filesystemu s projekty. U jednotlivých projektů zobrazuje normalizovaný podíl
CPU celého serveru a součet RAM všech jejich běžících Compose kontejnerů. Disk
se zjišťuje pouze metadata dotazem na filesystem; adresáře ani Docker volumes se
rekurzivně neprocházejí.
Při spuštění stránka živě ukazuje výstup `bench up` a po jeho úspěšném
dokončení naváže runtime logy kontejnerů. Stejný průběh se zobrazí i při startu
z URL vypnutého projektu. Při samostatném otevření logů stránka nejprve zobrazí
posledních 200 řádků každého aktuálního kontejneru a potom výstup živě doplňuje.
Logy se samostatně nearchivují, takže po odstranění kontejnerů příkazem
`docker compose down` už nejsou dostupné. Konfigurace se nadále upravuje přímo
v `bench.yml`. Neznámé subdomény zobrazí pouze stránku 404 s odkazem na Manager.

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
BENCH_PROJECTS_DIR=Projects
BENCH_DOMAIN=bench.example.dev
DUCKDNS_DOMAIN=example-bench.duckdns.org
DUCKDNS_API_TOKEN=00000000-0000-0000-0000-000000000000
```

`TS_HOSTNAME` je povinný při každém spuštění. `TS_AUTHKEY` je potřeba pouze
pro nový nebo odhlášený server a po úspěšném připojení jej lze z `.env`
odstranit. `BENCH_PROJECTS_DIR` je cesta relativní k home uživatele Benche a
její výchozí hodnota je `Projects`. `BENCH_DOMAIN` je adresa Manageru a
současně základ wildcard domény. `DUCKDNS_DOMAIN` slouží
pouze jako delegovaný cíl ACME challenge a `DUCKDNS_API_TOKEN` dovoluje Caddy
vytvořit potřebný TXT záznam. Soubor `.env` je ignorovaný Gitem a má syntaxi
Bash přiřazení.

Hodnoty lze předat také přímo. Proměnné z prostředí mají přednost před `.env`:

```bash
TS_HOSTNAME=bench-dev TS_AUTHKEY=tskey-auth-... \
BENCH_PROJECTS_DIR=Projects BENCH_DOMAIN=bench.example.dev \
DUCKDNS_DOMAIN=example-bench.duckdns.org \
DUCKDNS_API_TOKEN=00000000-0000-0000-0000-000000000000 \
./bootstrap.sh
```

## DNS konfigurace

Zjistěte Tailscale IPv4 adresu serveru:

```bash
tailscale ip -4
```

Pro výchozí hodnoty z `.env.example` vytvořte u správce DNS tři záznamy:

```text
bench.example.dev                   A       <TAILSCALE_IPV4>
*.bench.example.dev                 A       <TAILSCALE_IPV4>
_acme-challenge.bench.example.dev   CNAME   example-bench.duckdns.org.
```

První dva záznamy směrují Manager a všechny projektové hostname na privátní
adresu serveru. Třetí deleguje pouze ověření certifikátu. DuckDNS se nepoužívá
pro směrování provozu a jeho IP adresa proto není pro Bench podstatná.

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

Provisioning také ověří, že běžný uživatel může vytvořit izolovaný Bubblewrap
sandbox používaný Codexem. Globální AppArmor omezení pro unprivilegované user
namespaces přitom zůstává zapnuté. Pokud je k `/usr/bin/bwrap` připojen jiný
profil, playbook bezpečně skončí a existující bezpečnostní konfiguraci
nepřepíše. Samotný Codex provisioning neinstaluje.

## Přímé spuštění Ansible

Pokud už je Ansible nainstalovaný, lze provisioning spustit přímo:

```bash
set -a
source .env
set +a
export ANSIBLE_CONFIG="$PWD/ansible.cfg"
sudo --preserve-env=ANSIBLE_CONFIG,TS_HOSTNAME,TS_AUTHKEY,BENCH_PROJECTS_DIR,BENCH_DOMAIN,DUCKDNS_DOMAIN,DUCKDNS_API_TOKEN ansible-playbook \
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
│   │   ├── bench_cli/
│   │   ├── bench_manager/
│   │   ├── caddy/
│   │   ├── codex_sandbox/
│   │   ├── docker/
│   │   ├── projects/
│   │   └── tailscale/
│   └── playbook.yml
├── cli/
├── manager/
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
bwrap --ro-bind / / --unshare-user --unshare-pid --unshare-net true
tailscale status
docker --version
docker compose version
docker run --rm hello-world
docker network inspect bench-proxy
docker ps --filter name=bench-caddy
docker exec bench-caddy caddy version
docker exec bench-caddy caddy list-modules | grep '^dns.providers.duckdns$'
bench --version
bench list --json
systemctl is-active bench-manager
bench stats --json
test -S /run/bench/manager.sock
test -d "$HOME/Projects"
```

Z jiného zařízení připojeného ke stejnému tailnetu ověřte standardní SSH přes
MagicDNS:

```bash
ssh <user>@bench-dev
```

HTTPS ověřte z libovolného zařízení připojeného ke stejnému tailnetu:

```bash
curl https://bench.example.dev
curl https://test.bench.example.dev
```

První požadavek otevře Bench Manager. Očekávaná odpověď druhého požadavku je
`Bench Caddy is running`. Dokud nebude přidán Portless,
vrací Caddy stejnou testovací odpověď pro všechny názvy pod wildcard doménou.
