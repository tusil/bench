#!/usr/bin/env bash

set -Eeuo pipefail

if [[ ${EUID} -eq 0 ]]; then
  echo "Run this script as a regular user with sudo access, not as root." >&2
  exit 1
fi

repository_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
environment_file="${repository_dir}/.env"

shell_ts_hostname_is_set=false
shell_ts_authkey_is_set=false

if [[ -v TS_HOSTNAME ]]; then
  shell_ts_hostname_is_set=true
  shell_ts_hostname="${TS_HOSTNAME}"
fi

if [[ -v TS_AUTHKEY ]]; then
  shell_ts_authkey_is_set=true
  shell_ts_authkey="${TS_AUTHKEY}"
fi

if [[ -f "${environment_file}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${environment_file}"
  set +a
fi

if [[ "${shell_ts_hostname_is_set}" == true ]]; then
  export TS_HOSTNAME="${shell_ts_hostname}"
fi

if [[ "${shell_ts_authkey_is_set}" == true ]]; then
  export TS_AUTHKEY="${shell_ts_authkey}"
fi

if [[ -z ${TS_HOSTNAME:-} ]]; then
  echo "Set TS_HOSTNAME in ${environment_file} or in the environment." >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install --yes ansible-core

sudo --preserve-env=TS_HOSTNAME,TS_AUTHKEY ansible-playbook \
  --inventory "${repository_dir}/ansible/inventory/hosts.yml" \
  "${repository_dir}/ansible/playbook.yml"
