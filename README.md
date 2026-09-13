# Bench

Bench je reprodukovatelný headless Ubuntu server pro vývoj webových projektů.
Tento repozitář obsahuje pouze infrastrukturu a provisioning serveru; webová
administrace bude žít v samostatném repozitáři.

## První milestone

Aktuální provisioning podporuje čistou instalaci Ubuntu Server 24.04 LTS na
architekturách AMD64 a ARM64. Nainstaluje a nastaví pouze:

- základní balíčky `ca-certificates` a `curl`,
- Git,
- Docker Engine a containerd z oficiálního Docker APT repozitáře,
- Docker Compose plugin,
- adresář `~/Sites` pro projekty.

Caddy, Tailscale, Portless, zálohy, správa secrets, Bench Manager a projektové
šablony zatím nejsou součástí repozitáře.

## Požadavky

- Ubuntu Server 24.04 LTS,
- uživatel s oprávněním `sudo`,
- připojení k internetu.

Bootstrap ani playbook nespouštějte jako uživatel `root`. Provisioning nastaví
adresář projektů a přístup k Dockeru pro uživatele, který jej spustil.

## Instalace

```bash
git clone git@github.com:youngmedia/bench.git
cd bench
./bootstrap.sh
```

`bootstrap.sh` nainstaluje pouze `ansible-core` a spustí lokální playbook.
Ansible si při běhu vyžádá heslo pro `sudo`.

Po dokončení se odhlaste a znovu přihlaste, aby se projevilo členství ve
skupině `docker`.

## Přímé spuštění Ansible

Pokud už je Ansible nainstalovaný, lze provisioning spustit přímo:

```bash
ansible-playbook --ask-become-pass \
  --inventory ansible/inventory/hosts.yml \
  ansible/playbook.yml
```

Playbook je idempotentní a je bezpečné jej spouštět opakovaně.

## Struktura repozitáře

```text
.
├── ansible/
│   ├── inventory/
│   │   └── hosts.yml
│   ├── roles/
│   │   ├── base/
│   │   ├── docker/
│   │   └── projects/
│   └── playbook.yml
├── AGENTS.md
├── bootstrap.sh
└── README.md
```

## Ověření instalace

Po novém přihlášení lze instalaci ověřit:

```bash
git --version
docker --version
docker compose version
docker run --rm hello-world
test -d "$HOME/Sites"
```

První čtyři kontroly vypíšou nainstalované verze nebo úspěšný Docker test.
Poslední příkaz skončí s návratovým kódem `0`, pokud adresář projektů existuje.
