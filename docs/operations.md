# Provoz a ověření

## Bench Manager

Manager běží jako systemd služba `bench-manager` a přes Unix socket jej
zpřístupňuje Caddy. Dostupný je pouze z tailnetu na HTTPS adrese nakonfigurované
v `BENCH_DOMAIN`.

Caddy běží v Dockeru. Služba `bench-caddy` při startu systému počká na Tailscale
a znovu vytvoří Caddy kontejner, aby obnovila jeho síť a porty. Certifikáty
zůstávají v Docker volume.

Dashboard zobrazuje přímé podadresáře projektového adresáře s platným nebo
chybným `bench.yml`, jejich routy a stav. Projekty lze spouštět, zastavovat a
otevírat jejich logy.

Každých pět sekund obnovuje:

- využití CPU celého serveru,
- RAM a swap,
- využití filesystemu s projekty,
- CPU a RAM běžících Compose kontejnerů jednotlivých projektů.

Projektové CPU je normalizované jako podíl celého serveru. RAM je součet všech
běžících kontejnerů projektu. Disk se zjišťuje metadatovým dotazem na filesystem;
adresáře ani Docker volumes se rekurzivně neprocházejí.

Při spuštění projektu Manager živě zobrazuje výstup `bench up` a po úspěchu
naváže runtime logy kontejnerů. Samostatná stránka logů nejprve načte posledních
200 řádků a potom výstup průběžně doplňuje. Konfigurace projektu se upravuje
přímo v `bench.yml`.

Požadavek na route vypnutého projektu zobrazí možnost projekt spustit. Neznámá
subdoména vrátí stránku 404 s odkazem na Manager.

## Cílené nasazení CLI

Pokud se změnilo pouze Bench CLI, lze nasadit jeho Ansible roli bez změn
ostatních služeb. Načtěte stejné prostředí jako při plném provisioningu a
spusťte playbook s tagem `bench_cli`:

```bash
set -a
source .env
set +a
export ANSIBLE_CONFIG="$PWD/ansible.cfg"
sudo --preserve-env=ANSIBLE_CONFIG,TS_HOSTNAME,TS_AUTHKEY,BENCH_PROJECTS_DIR,BENCH_TEMPLATE_REPOSITORY_PREFIX,BENCH_DOMAIN,DUCKDNS_DOMAIN,DUCKDNS_API_TOKEN ansible-playbook \
  --inventory ansible/inventory/hosts.yml \
  --tags bench_cli \
  ansible/playbook.yml
```

Role zkopíruje aktuální CLI zdroje, podle potřeby je zkompiluje a ponechá
`/usr/local/bin/bench` napojený na spravovaný build v `/opt/bench/cli`.

## Ověření instalace

Po novém přihlášení ověřte systémové komponenty:

```bash
git --version
bwrap --ro-bind / / --unshare-user --unshare-pid --unshare-net true
tailscale status
docker --version
docker compose version
docker run --rm hello-world
docker network inspect bench-proxy
```

Potom ověřte Caddy, CLI a Manager:

```bash
docker ps --filter name=bench-caddy
systemctl is-active bench-caddy
docker exec bench-caddy caddy version
docker exec bench-caddy caddy list-modules | grep '^dns.providers.duckdns$'
bench --version
bench list --json
bench stats --json
systemctl is-active bench-manager
test -S /run/bench/manager.sock
test -d "$HOME/Projects"
```

Pokud používáte vlastní `BENCH_PROJECTS_DIR`, upravte poslední příkaz podle něj.

Z jiného zařízení ve stejném tailnetu ověřte standardní SSH přes MagicDNS:

```bash
ssh <user>@bench-dev
```

Nakonec ověřte Manager a neznámou projektovou subdoménu:

```bash
curl https://bench.example.dev
curl --fail-with-body https://unknown.bench.example.dev
```

První požadavek vrátí Manager. Druhý má vrátit jeho 404 stránku; `curl` kvůli
očekávanému HTTP 404 skončí s nenulovým návratovým kódem.

## Důležité cesty a služby

| Cesta nebo služba | Obsah |
| --- | --- |
| `/etc/bench/config.json` | Systémová konfigurace CLI |
| `/etc/bench/caddy/` | Compose projekt a konfigurace Caddy |
| `/etc/bench/caddy/generated/` | Routy generované příkazem `bench` |
| `/opt/bench/cli/` | Nainstalovaný zdroj a build CLI |
| `/opt/bench/manager/` | Nainstalovaný build Manageru |
| `/run/bench/manager.sock` | Unix socket Manageru |
| `bench-caddy` | Stabilní název Caddy kontejneru |
| `bench-caddy.service` | Obnovení Caddy kontejneru po startu systému |
| `bench-manager.service` | Webová administrační služba |

## Struktura repozitáře

```text
.
├── ansible/
│   ├── inventory/
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
├── docs/
├── manager/
├── .env.example
├── ansible.cfg
├── bootstrap.sh
└── README.md
```

`bootstrap.sh` zůstává záměrně malý: nainstaluje Ansible a předá konfiguraci
playbooku. Veškerá systémová konfigurace má být reprodukovatelná z Ansible rolí.
