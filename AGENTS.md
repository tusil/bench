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

## Bench Manager UI

- Use Nuxt UI components first for UI patterns they support, including buttons, links, cards, badges, alerts, empty states, loading states and page structure.
- Do not recreate a component with raw HTML and Tailwind when Nuxt UI already provides it.
- Use Tailwind primarily for layout, positioning, spacing, sizing, responsive behavior, truncation and basic content typography.
- Prefer component props, variants and slots over utility classes.
- Use a component's `ui` override only for necessary slot layout that cannot be applied to its root; do not use it to create a custom visual style.
- Keep the default Nuxt UI colors, radii, shadows and backgrounds unless the user explicitly requests a theme change.
- Use native HTML for semantic content when a Nuxt UI component would not add useful behavior or structure.
- Before adding custom CSS, verify that Nuxt UI does not already provide the required component, prop, variant or design token.

## Git

Use Conventional Commits:

`type(scope): description`

Scope is optional.
