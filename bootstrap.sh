#!/usr/bin/env bash

set -Eeuo pipefail

if [[ ${EUID} -eq 0 ]]; then
  echo "Run this script as a regular user with sudo access, not as root." >&2
  exit 1
fi

repository_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
environment_file="${repository_dir}/.env"
export ANSIBLE_CONFIG="${repository_dir}/ansible.cfg"

environment_variables=(
  TS_HOSTNAME
  TS_AUTHKEY
  BENCH_PROJECTS_DIR
  BENCH_DOMAIN
  DUCKDNS_DOMAIN
  DUCKDNS_API_TOKEN
)

declare -A shell_environment=()

for variable in "${environment_variables[@]}"; do
  if [[ -v ${variable} ]]; then
    shell_environment["${variable}"]="${!variable}"
  fi
done

if [[ -f "${environment_file}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${environment_file}"
  set +a
fi

for variable in "${environment_variables[@]}"; do
  if [[ -v "shell_environment[${variable}]" ]]; then
    printf -v "${variable}" '%s' "${shell_environment[${variable}]}"
    export "${variable}"
  fi
done

required_environment_variables=(
  TS_HOSTNAME
  BENCH_DOMAIN
  DUCKDNS_DOMAIN
  DUCKDNS_API_TOKEN
)

for variable in "${required_environment_variables[@]}"; do
  if [[ -z ${!variable:-} ]]; then
    echo "Set ${variable} in ${environment_file} or in the environment." >&2
    exit 1
  fi
done

sudo apt-get update
sudo apt-get install --yes ansible-core

sudo --preserve-env=ANSIBLE_CONFIG,TS_HOSTNAME,TS_AUTHKEY,BENCH_PROJECTS_DIR,BENCH_DOMAIN,DUCKDNS_DOMAIN,DUCKDNS_API_TOKEN ansible-playbook \
  --inventory "${repository_dir}/ansible/inventory/hosts.yml" \
  "${repository_dir}/ansible/playbook.yml"
