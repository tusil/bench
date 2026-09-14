# Bench repository instructions

Bench is a reproducible headless Ubuntu development server.

This repository contains the infrastructure, provisioning, CLI and web administration application for the Bench server.

## Principles

- Follow KISS, YAGNI and DRY.
- Prefer simple, explicit solutions over abstractions.
- All provisioning must be reproducible from a clean Ubuntu Server installation.
- Configuration should be idempotent and safe to run repeatedly.
- Prefer Ansible for system configuration.
- Keep `bootstrap.sh` minimal; it should only install prerequisites and invoke Ansible.
- Do not manually configure services when the same configuration can live in this repository.
- Do not add functionality unless it is currently required.

## Current scope

The repository includes:

- base Ubuntu packages and Git
- Docker Engine and Docker Compose
- Tailscale connectivity
- Caddy with private wildcard HTTPS routing
- the `bench` project lifecycle CLI
- the Nuxt Bench Manager
- the configurable project directory

Do not add yet:

- Portless
- firewall management
- backups
- secrets management
- project templates

## Git

Use Conventional Commits:

`type(scope): description`

Scope is optional.
