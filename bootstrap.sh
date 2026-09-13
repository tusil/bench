#!/usr/bin/env bash

set -Eeuo pipefail

if [[ ${EUID} -eq 0 ]]; then
  echo "Run this script as a regular user with sudo access, not as root." >&2
  exit 1
fi

repository_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

sudo apt-get update
sudo apt-get install --yes ansible-core

ansible-playbook \
  --ask-become-pass \
  --inventory "${repository_dir}/ansible/inventory/hosts.yml" \
  "${repository_dir}/ansible/playbook.yml"
