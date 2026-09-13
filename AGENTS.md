# Bench repository instructions

Bench is a reproducible headless Ubuntu development server.

This repository contains only the infrastructure and provisioning of the Bench server.
The Bench web administration application lives in a separate repository.

## Principles

- Follow KISS, YAGNI and DRY.
- Prefer simple, explicit solutions over abstractions.
- All provisioning must be reproducible from a clean Ubuntu Server installation.
- Configuration should be idempotent and safe to run repeatedly.
- Prefer Ansible for system configuration.
- Keep `bootstrap.sh` minimal; it should only install prerequisites and invoke Ansible.
- Do not manually configure services when the same configuration can live in this repository.
- Do not add functionality unless it is currently required.

## Initial scope

The first milestone includes only:

- base Ubuntu packages
- Git
- Docker Engine
- Docker Compose
- project directory structure

Do not add yet:

- Caddy
- Tailscale
- Portless
- backups
- secrets management
- Bench Manager
- project templates

## Git

Use Conventional Commits:

`type(scope): description`

Scope is optional.
