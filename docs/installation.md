# Instalace Benche

Tento dokument popisuje přípravu čistého Ubuntu serveru, DNS a opakovatelné
spuštění provisioningu. Rychlý přehled projektu je v [README](../README.md).

## Požadavky

- Ubuntu Server 24.04 nebo 26.04 LTS,
- architektura AMD64 nebo ARM64,
- běžný uživatel s oprávněním `sudo`,
- připojení k internetu,
- existující Tailscale tailnet a jednorázový auth key pro nový server,
- vlastní doména, u které lze nastavit DNS záznamy,
- DuckDNS doména a její account token pro ACME DNS challenge.

Bootstrap ani playbook nespouštějte jako `root`. Provisioning nastaví přístup k
Dockeru a adresář projektů pro uživatele, který instalaci spustil.

## Konfigurace

Naklonujte repozitář a vytvořte lokální konfiguraci z verzovaného příkladu:

```bash
git clone https://github.com/tusil/bench.git
cd bench
cp .env.example .env
```

V `.env` nastavte:

```dotenv
TS_HOSTNAME=bench-dev
TS_AUTHKEY=tskey-auth-...
BENCH_PROJECTS_DIR=Projects
BENCH_DOMAIN=bench.example.dev
DUCKDNS_DOMAIN=example-bench.duckdns.org
DUCKDNS_API_TOKEN=00000000-0000-0000-0000-000000000000
```

| Proměnná | Význam |
| --- | --- |
| `TS_HOSTNAME` | Unikátní hostname serveru v Tailscale MagicDNS; povinný při každém běhu |
| `TS_AUTHKEY` | Auth key potřebný pouze pro nový nebo odhlášený server |
| `BENCH_PROJECTS_DIR` | Cesta k projektům relativní k home uživatele; výchozí `Projects` |
| `BENCH_DOMAIN` | Doména Manageru a základ wildcard domény projektů |
| `DUCKDNS_DOMAIN` | Delegovaný cíl ACME challenge, nikoliv adresa pro provoz |
| `DUCKDNS_API_TOKEN` | Token, kterým Caddy vytváří ACME TXT záznam |

Soubor `.env` je ignorovaný Gitem a používá syntaxi Bash přiřazení. Hodnoty
předané přímo v prostředí mají přednost před obsahem souboru.

Po prvním úspěšném připojení serveru lze `TS_AUTHKEY` z `.env` odstranit.

## DNS

Pro doménu použitou v příkladu vytvořte následující záznamy:

```text
bench.example.dev                   A       <TAILSCALE_IPV4>
*.bench.example.dev                 A       <TAILSCALE_IPV4>
_acme-challenge.bench.example.dev   CNAME   example-bench.duckdns.org.
```

První dva záznamy směrují Manager a projektové hostname na privátní Tailscale
adresu serveru. Třetí deleguje pouze ověření wildcard certifikátu. IP adresa
DuckDNS domény proto není pro routing Benche důležitá.

Tailscale IPv4 adresu připojeného serveru zjistíte příkazem:

```bash
tailscale ip -4
```

Záznamy jsou dostupné pouze klientům, kteří dokážou směrovat na danou Tailscale
adresu; veřejný DNS záznam s privátní Tailscale IP sám o sobě aplikace
nezpřístupní do internetu.

## Provisioning

Spusťte bootstrap jako běžný uživatel:

```bash
./bootstrap.sh
```

Bootstrap načte konfiguraci, nainstaluje pouze `ansible-core` a spustí lokální
playbook. Ansible si během instalace vyžádá heslo pro `sudo`.

Po dokončení se odhlaste a znovu přihlaste, aby nový shell získal členství ve
skupině `docker`.

Provisioning je idempotentní a lze jej spustit opakovaně. Již připojený server
nepotřebuje Tailscale auth key; změna `TS_HOSTNAME` aktualizuje jeho hostname.

## Přímé spuštění Ansible

Pokud už je Ansible nainstalovaný, lze bootstrap přeskočit:

```bash
set -a
source .env
set +a
export ANSIBLE_CONFIG="$PWD/ansible.cfg"
sudo --preserve-env=ANSIBLE_CONFIG,TS_HOSTNAME,TS_AUTHKEY,BENCH_PROJECTS_DIR,BENCH_DOMAIN,DUCKDNS_DOMAIN,DUCKDNS_API_TOKEN ansible-playbook \
  --inventory ansible/inventory/hosts.yml \
  ansible/playbook.yml
```

## Codex sandbox

Provisioning instaluje Bubblewrap a cílený AppArmor profil a následně ověří,
že běžný uživatel může vytvořit izolovaný sandbox. Globální Ubuntu omezení pro
unprivilegované user namespaces zůstává zapnuté.

Pokud je k `/usr/bin/bwrap` připojen jiný AppArmor profil, playbook skončí bez
přepsání existující bezpečnostní konfigurace. Samotný Codex se neinstaluje.

Po instalaci pokračujte dokumentem [Provoz a ověření](operations.md).
