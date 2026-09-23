# Konfigurace projektů

Bench spravuje přímé podadresáře nakonfigurovaného adresáře projektů, které v
kořeni obsahují `bench.yml`. Samotný Compose projekt zůstává nezávislý na
Benchi a nemusí deklarovat jeho Docker network.

## Vytvoření konfigurace

V kořeni existujícího Compose projektu spusťte:

```bash
bench init
```

Příkaz odvodí `name` z názvu aktuálního adresáře a vytvoří výchozí route
`app:3000`. Existující `bench.yml` nikdy nepřepíše.

Název lze zadat explicitně jako platný lowercase DNS slug:

```bash
bench init --name my-project
```

## Vytvoření projektu ze šablony

V prázdném aktuálním adresáři lze vytvořit celý projekt z Git šablony:

```bash
bench init --template nuxt
bench init --template=nuxt --name=my-project
```

Repozitář vznikne připojením aliasu k prefixu nastavenému pomocí
`BENCH_TEMPLATE_REPOSITORY_PREFIX`. Bench naklonuje jeho výchozí větev, přepíše
top-level `name` v `bench.yml`, případně spustí `.bench/hooks/init.mjs` a založí
nový Git repozitář na větvi `main`. Historie ani remote šablony se nepřenášejí a
počáteční commit se nevytváří.

Hook se spouští přes Node v kořeni připravovaného projektu s argumenty
`--name <slug>` a `--url <https-url>`. Po úspěchu Bench odstraní celou `.bench`.
Používejte proto jen důvěryhodné template repozitáře. Při jakékoliv chybě zůstane
cílový adresář prázdný.

```yaml
name: operon

routes:
  - service: frontend
    port: 3000

  - domain: api-operon.bench.example.dev
    service: backend
    port: 3333
```

## Pole `name`

`name` je povinný lowercase DNS slug o délce nejvýše 63 znaků. Začíná a končí
písmenem nebo číslicí a uvnitř může obsahovat pomlčky.

Název se používá pro výchozí doménu, Docker aliasy a název generovaného Caddy
fragmentu. Všechny projekty proto musí mít unikátní `name`.

## VS Code workspace

Detail projektu v Bench Manageru nabízí otevření přes VS Code Remote SSH.
Volitelným polem `workspace` v `bench.yml` lze zvolit soubor workspace:

```yaml
workspace: .vscode/dev.code-workspace
```

Cesta musí být relativní vůči kořeni projektu, zůstat uvnitř něj a končit na
`.code-workspace`. Bench neověřuje, zda soubor existuje. Pokud pole chybí,
Bench automaticky použije jediný `.code-workspace` soubor v kořeni projektu.
Při žádném nebo více takových souborech otevře VS Code složku projektu.

## Routy

`routes` je neprázdné pole. Každá route obsahuje:

- `service` — název existující Compose služby,
- `port` — port služby v kontejneru v rozsahu 1–65535,
- `domain` — volitelný hostname,
- `preserveHost` — volitelný boolean, ve výchozím stavu `true`.

Pokud `domain` chybí, použije se:

```text
{name}.<BENCH_DOMAIN>
```

Explicitní doména musí ležet právě jednu úroveň pod `BENCH_DOMAIN`, aby ji
pokryl wildcard certifikát. Správně je například
`api-operon.bench.example.dev`; vnořený hostname
`api.operon.bench.example.dev` povolený není. Domény se v jednom projektu
nesmí opakovat.

### Vývojové servery s kontrolou hostu

Některé vývojové servery, například Vite, ve výchozím stavu odmítnou veřejný
hostname předaný reverzní proxy. Pro takovou routu vypněte zachování hlavičky
`Host`:

```yaml
routes:
  - domain: docs-operon.bench.example.dev
    service: docs
    port: 3000
    preserveHost: false
```

Bench pak upstreamu pošle `Host: localhost`, který Vite standardně povoluje.
Původní veřejný hostname zůstává dostupný ve standardní hlavičce
`X-Forwarded-Host`. Nastavení je záměrně volitelné, protože některé aplikace
hlavičku `Host` používají pro vlastní routing. Nepoužívejte jako obecnou náhradu
Vite `allowedHosts: true`, které vypíná ochranu proti DNS rebindingu.

## Vlastní příkazy

Bez další konfigurace Bench používá:

```yaml
commands:
  compose: docker compose
  up: docker compose up -d
  down: docker compose down
```

Projekt s vlastním Compose souborem nebo npm skripty může příkazy přepsat:

```yaml
commands:
  compose: docker compose -f compose.dev.yml --profile dev
  up: npm run docker:dev:up
  down: npm run docker:dev:down
```

`commands.up` a `commands.down` musí být uvedené společně. `commands.compose`
musí označovat stejný Compose projekt jako vlastní lifecycle příkazy, protože
přes něj Bench ověřuje služby, hledá kontejnery a čte logy. Příkazy se spouštějí
přes `/bin/sh -c` v kořeni projektu.

## Spuštění a zastavení

```bash
bench up
bench down
```

Při `bench up` Bench:

1. ověří služby uvedené v routách,
2. spustí projekt,
3. najde běžící kontejnery routovaných služeb,
4. připojí pouze tyto kontejnery do `bench-proxy`,
5. atomicky zapíše a validuje Caddy konfiguraci,
6. reloadne Caddy a vypíše výsledné HTTPS adresy.

Docker alias má deterministický tvar `{name}-{service}`. Databáze, Redis ani
jiné služby nepoužité v `routes` se do proxy network automaticky nepřipojují.

Pokud konfigurace nebo Caddy reload selže, Bench obnoví předchozí route a nově
připojené kontejnery od sítě odpojí. Běžící projekt nechá zachovaný, aby nedošlo
ke ztrátě stavu.

`bench down` nejprve bezpečně odebere route a reloadne Caddy, potom spustí
nakonfigurovaný příkaz `down`.

## Logy

Posledních 200 řádků všech služeb aktuálního Compose projektu zobrazíte:

```bash
bench logs
```

Počet řádků lze změnit a výstup průběžně sledovat:

```bash
bench logs --tail 100 --follow
```

Bench logy samostatně nearchivuje. Po odstranění kontejnerů příkazem
`docker compose down` proto jejich dřívější výstup nemusí být dostupný.
