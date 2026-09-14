# Bench – automatická integrace projektů přes `bench.yml`

Cílem je rozšířit projekt **Bench** o jednoduchý mechanismus, který umožní jednotlivým projektům deklarovat jejich napojení na Bench pomocí souboru `bench.yml`.

Bench následně automaticky:

* spustí projekt přes Docker Compose,
* najde správné kontejnery,
* připojí pouze potřebné kontejnery do společné Docker network,
* vygeneruje Caddy konfiguraci,
* reloadne Caddy,
* zpřístupní projekt na `*.bench.example.dev`.

Dodržuj principy YAGNI, KISS a DRY. Nevytvářej zatím GUI ani komplexní abstrakce pro budoucí funkce.

## Základní princip

Každý projekt zůstává samostatný a jeho `docker-compose.yml` nesmí být závislý na Benchi.

Bench nesmí vyžadovat, aby projekty obsahovaly:

```yaml
networks:
  - bench
```

Integrace s Benchem bude řešena pouze přes:

```text
bench.yml
```

Základní soubor lze vytvořit příkazem `bench init`. Název projektu odvodí
z aktuálního adresáře, vytvoří výchozí route `app:3000` k následné úpravě a
existující `bench.yml` nikdy nepřepíše.

Bench připojí příslušný běžící kontejner do vlastní Docker network dodatečně pomocí `docker network connect`.

## Příklad projektu

Projekt může obsahovat například:

```text
operon/
├── docker-compose.yml
├── bench.yml
└── ...
```

Příklad `bench.yml`:

```yaml
name: operon

commands:
  compose: docker compose -f compose.dev.yml --profile dev
  up: npm run docker:dev:up
  down: npm run docker:dev:down

routes:
  - service: frontend
    port: 3000

  - domain: api-operon.bench.example.dev
    service: backend
    port: 3333
```

Pokud `domain` není uvedena, odvodí se automaticky:

```text
{name}.bench.example.dev
```

V tomto případě:

```text
operon.bench.example.dev
```

Explicitní `domain` má přednost.

Doména musí mít právě jeden label před `bench.example.dev`, aby ji pokryl
wildcard certifikát `*.bench.example.dev`. Další route proto používají plochý
tvar jako `api-operon.bench.example.dev`; vnořený tvar
`api.operon.bench.example.dev` není povolený.

Sekce `commands` je volitelná a platí pro celý projekt. Výchozí hodnoty jsou:

```yaml
commands:
  compose: docker compose
  up: docker compose up -d
  down: docker compose down
```

Vlastní `up` a `down` musí být uvedeny společně. `compose` slouží pro příkazy
`config --services` a `ps -q <service>` a musí označovat stejný Compose projekt,
který spouští vlastní `up`. Příkazy se spouštějí přes `/bin/sh -c` v kořeni
projektu.

## Docker networking

Bench má vytvořit vlastní externí Docker network, například:

```text
bench-proxy
```

Pokud neexistuje, provisioning ji vytvoří ještě před spuštěním Caddy.

Projektové služby se nemají do této network deklarovat v Compose.

Po spuštění projektu Bench zjistí container ID služby:

```bash
docker compose ps -q frontend
```

a připojí jej:

```bash
docker network connect \
  --alias operon-frontend \
  bench-proxy \
  <container-id>
```

Alias musí být deterministický a bezpečný pro Docker DNS.

Například:

```text
{name}-{service}
```

tedy:

```text
operon-frontend
operon-backend
```

Pokud už je container do network připojený, operace nesmí skončit chybou.

Do `bench-proxy` network připojuj pouze služby použité v `routes`.

Databáze, Redis a další interní služby projektu tam automaticky nepřipojuj.

## Caddy

Caddy poběží v Docker Compose projektu spravovaném Ansiblem a bude připojený
do externí sítě `bench-proxy`.

Použij generované Caddy fragmenty, ne Caddy Admin API.

Pevná struktura infrastruktury je:

```text
/etc/bench/caddy/
├── Caddyfile
├── compose.yml
├── Dockerfile
├── duckdns.env
└── generated/
    ├── operon.caddy
    └── other-project.caddy
```

Docker publikuje porty Caddy pouze na Tailscale IPv4 hostitele. Certifikát,
DNS challenge a fallback odpověď spravuje hlavní Caddyfile. Generované
fragmenty se importují jako route direktivy uvnitř wildcard site bloku:

```caddyfile
https://*.bench.example.dev {
    tls {
        dns duckdns {env.DUCKDNS_API_TOKEN} {
            override_domain example-bench.duckdns.org
        }
    }

    route {
        import /etc/bench/caddy/generated/*.caddy
        respond "Bench Caddy is running"
    }
}
```

Pro výše uvedený `bench.yml` vytvoř:

```caddyfile
@route_operon_0 host operon.bench.example.dev
handle @route_operon_0 {
    reverse_proxy operon-frontend:3000
}

@route_operon_1 host api-operon.bench.example.dev
handle @route_operon_1 {
    reverse_proxy operon-backend:3333
}
```

Generovaný config musí být deterministický. Matcher se odvodí z bezpečného
názvu projektu a indexu route. Fragment nesmí obsahovat top-level site blok,
TLS konfiguraci ani listener.

Adresář `generated` vlastní uživatel Benche. Zbytek Caddy infrastruktury a
soubor s DuckDNS tokenem spravuje root; token má mód `0600`. Compose služba má
stabilní jméno kontejneru `bench-caddy`, takže CLI nemusí číst Compose soubor
ani secret.

Před reloadem validuj celý Caddyfile uvnitř běžícího kontejneru:

```bash
docker exec bench-caddy \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Po úspěšné validaci proveď reload stejným způsobem přes `docker exec` příkazem
`caddy reload`. Nepoužívej Caddy Admin API přímo.

Při změně fragmentu nejprve uchovej předchozí obsah a nový soubor nahraď
atomicky. Pokud validace selže, obnov předchozí fragment nebo nový odstraň,
reload neprováděj a vypiš srozumitelnou chybu.

## CLI

Pro první verzi implementuj minimálně:

```bash
bench up
```

spuštěné v adresáři projektu.

Postup:

1. najdi `bench.yml`,
2. načti a validuj konfiguraci,
3. spusť nakonfigurovaný příkaz `commands.up`,

4. pro každou route:

   * zjisti container ID služby,
   * připoj container do `bench-proxy`,
   * nastav Docker network alias,
5. vygeneruj Caddy config projektu,
6. validuj Caddy konfiguraci,
7. reloadni Caddy uvnitř Compose služby,
8. vypiš dostupné URL.

Příklad výsledku:

```text
Project operon started.

Routes:
  https://operon.bench.example.dev
  https://api-operon.bench.example.dev
```

Implementuj také:

```bash
bench down
```

Ten má:

1. odstranit Caddy fragment projektu,
2. validovat výslednou konfiguraci a reloadnout Caddy uvnitř Compose služby,
3. spustit nakonfigurovaný příkaz `commands.down`.

Není potřeba explicitně odpojovat kontejnery z `bench-proxy`, protože po odstranění kontejnerů jejich network membership zanikne.

## Validace `bench.yml`

Minimálně validuj:

* `name` je povinné,
* `routes` je neprázdné pole,
* `commands.compose` je neprázdný string, pokud je uveden,
* vlastní `commands.up` a `commands.down` jsou neprázdné stringy a musí být uvedeny společně,
* každá route má `service`,
* každá route má validní TCP port,
* doména je string, pokud je uvedena,
* doména má právě jeden label před základní Bench doménou,
* nesmí vzniknout dvě stejné domény v rámci jednoho projektu,
* doména nesmí kolidovat s fragmentem jiného projektu v `generated`.

Pro první verzi není potřeba vytvářet komplexní schema framework.

Použij jednoduché řešení odpovídající současnému stacku projektu.

## Chybové stavy

Chyby musí být srozumitelné.

Například:

```text
bench.yml not found
```

```text
Service "frontend" does not exist in docker-compose.yml
```

```text
Service "frontend" is not running
```

```text
Port must be between 1 and 65535
```

```text
Failed to validate generated Caddy configuration
```

Nepokračuj do dalších kroků, pokud by výsledkem byl nekonzistentní stav.

## Důležité

Nevytvářej zatím:

* GUI,
* Cloudflare Tunnel,
* Tailscale konfiguraci,
* public sharing,
* project templates,
* discovery všech projektů,
* daemon/background service,
* databázi,
* Caddy Admin API integraci.

Tyto věci přijdou později.

Teď chceme pouze stabilní základ:

```text
bench.yml
    ↓
docker compose
    ↓
bench-proxy network
    ↓
generated Caddy config
    ↓
project.bench.example.dev
```

## Výsledek

Po implementaci musí fungovat scénář:

```bash
cd ~/Projects/operon
bench up
```

a projekt bude dostupný například na:

```text
https://operon.bench.example.dev
```

bez toho, aby projekt musel:

* publikovat host port,
* upravovat svůj `docker-compose.yml`,
* znát existenci Caddy,
* znát Docker network Benche.

Před implementací nejdřív prohlédni existující strukturu repozitáře Bench a přizpůsob řešení současné architektuře. Nevytvářej novou architektonickou vrstvu, pokud ji stávající projekt nepotřebuje.

Na konci:

1. shrň provedené změny,
2. napiš, jak funkčnost lokálně otestovat,
3. pokud dávají smysl testy, přidej je,
4. nevytvářej commit, pokud k tomu nejsi explicitně vyzván.
