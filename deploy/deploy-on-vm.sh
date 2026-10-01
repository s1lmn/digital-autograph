#!/usr/bin/env bash
set -euo pipefail

root=/opt/digital-autograph
config=/etc/digital-autograph/deploy.conf
state=/var/lib/digital-autograph

if [[ ! -r "$config" ]]; then
  echo "Missing VM deployment configuration: $config" >&2
  exit 1
fi

# This file contains non-secret environment names, domains, and resource IDs.
source "$config"

if [[ $# -ne 1 ]]; then
  echo "Usage: deploy-on-vm.sh <40-character-image-sha|rollback>" >&2
  exit 2
fi

action=$1
if [[ "$action" == rollback ]]; then
  if [[ ! -s "$state/previous-image-tag" ]]; then
    echo "No previous release is recorded for rollback" >&2
    exit 1
  fi
  image_tag=$(<"$state/previous-image-tag")
  if [[ ! "$image_tag" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Recorded previous image tag is invalid" >&2
    exit 1
  fi
  rollback=true
elif [[ "$action" =~ ^[0-9a-f]{40}$ ]]; then
  image_tag=$action
  rollback=false
else
  echo "Deployment image tag must be a 40-character lowercase commit SHA" >&2
  exit 2
fi

for name in APP_ENV YC_REGISTRY_ID YC_LOCKBOX_API_SECRET_ID \
  YC_LOCKBOX_WORKER_SECRET_ID WEB_DOMAIN API_DOMAIN; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing $name in $config" >&2
    exit 1
  fi
done

if [[ "$APP_ENV" != staging && "$APP_ENV" != production ]]; then
  echo "APP_ENV must be staging or production" >&2
  exit 1
fi

if [[ "$rollback" == false && -e "$state/current-image-tag" ]]; then
  old_image_tag=$(<"$state/current-image-tag")
elif [[ "$rollback" == true && -e "$state/current-image-tag" ]]; then
  old_image_tag=$(<"$state/current-image-tag")
fi
if [[ -n "${old_image_tag:-}" && ! "$old_image_tag" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Recorded current image tag is invalid" >&2
  exit 1
fi

install -d -m 700 /etc/digital-autograph/env "$state"
umask 077
for app in api worker; do
  secret_id_var="YC_LOCKBOX_${app^^}_SECRET_ID"
  secret_id=${!secret_id_var}
  yc lockbox payload get --id "$secret_id" --format json |
    node "$root/render-lockbox-env.mjs" "/etc/digital-autograph/env/$app.env"
done

export APP_ENV YC_REGISTRY_ID IMAGE_TAG=$image_tag WEB_DOMAIN API_DOMAIN
release_file="$root/release.env.tmp"
printf 'APP_ENV=%s\nYC_REGISTRY_ID=%s\nIMAGE_TAG=%s\nWEB_DOMAIN=%s\nAPI_DOMAIN=%s\n' \
  "$APP_ENV" "$YC_REGISTRY_ID" "$image_tag" "$WEB_DOMAIN" "$API_DOMAIN" \
  >"$release_file"
chmod 600 "$release_file"
mv "$release_file" "$root/release.env"
cd "$root"

registry_token=$(yc iam create-token)
printf '%s' "$registry_token" |
  docker login --username iam --password-stdin cr.yandex >/dev/null
unset registry_token

trap 'docker logout cr.yandex >/dev/null 2>&1 || true' EXIT
docker compose --env-file "$root/release.env" -f "$root/compose.yaml" pull
if [[ "$rollback" == false ]]; then
  docker compose --env-file "$root/release.env" -f "$root/compose.yaml" \
    run --rm migration
fi
compose_updated=true
if ! docker compose --env-file "$root/release.env" -f "$root/compose.yaml" \
  up -d --remove-orphans; then
  compose_updated=false
  echo "Compose update reported an error; checking health and attempting rollback if needed." >&2
fi

function application_images_match() {
  local target container_id expected_image
  for target in api web worker; do
    container_id=$(docker compose --env-file "$root/release.env" \
      -f "$root/compose.yaml" ps -q "$target")
    expected_image="cr.yandex/$YC_REGISTRY_ID/digital-autograph/$target:$IMAGE_TAG"
    if [[ -z "$container_id" ]] ||
       [[ "$(docker inspect --format '{{.State.Status}}' "$container_id")" != running ]] ||
       [[ "$(docker inspect --format '{{.Config.Image}}' "$container_id")" != "$expected_image" ]]; then
      return 1
    fi
  done
}

for attempt in $(seq 1 30); do
  if [[ "$compose_updated" != true ]]; then break; fi
  worker_id=$(docker compose --env-file "$root/release.env" \
    -f "$root/compose.yaml" ps -q worker)
  if application_images_match &&
    curl --fail --silent --show-error --max-time 5 \
    "https://$API_DOMAIN/health/ready" >/dev/null &&
    curl --fail --silent --show-error --max-time 5 \
      "https://$WEB_DOMAIN/" >/dev/null &&
    [[ -n "$worker_id" ]] &&
    [[ "$(docker inspect --format '{{.State.Status}}' "$worker_id")" == running ]]; then
    if [[ -n "${old_image_tag:-}" && "$old_image_tag" != "$image_tag" ]]; then
      printf '%s\n' "$old_image_tag" >"$state/previous-image-tag"
    fi
    printf '%s\n' "$image_tag" >"$state/current-image-tag"
    chmod 600 "$state/current-image-tag"
    if [[ -e "$state/previous-image-tag" ]]; then
      chmod 600 "$state/previous-image-tag"
    fi
    echo "Deployment smoke checks passed for $image_tag"
    exit 0
  fi
  sleep 2
done

if [[ -n "${old_image_tag:-}" && "$old_image_tag" != "$image_tag" ]]; then
  echo "Smoke checks failed; restoring previous application image $old_image_tag." >&2
  export IMAGE_TAG=$old_image_tag
  printf 'APP_ENV=%s\nYC_REGISTRY_ID=%s\nIMAGE_TAG=%s\nWEB_DOMAIN=%s\nAPI_DOMAIN=%s\n' \
    "$APP_ENV" "$YC_REGISTRY_ID" "$old_image_tag" "$WEB_DOMAIN" "$API_DOMAIN" \
    >"$release_file"
  chmod 600 "$release_file"
  mv "$release_file" "$root/release.env"
  if docker compose --env-file "$root/release.env" -f "$root/compose.yaml" pull &&
    docker compose --env-file "$root/release.env" -f "$root/compose.yaml" \
      up -d --remove-orphans; then
    for attempt in $(seq 1 30); do
      if application_images_match &&
        curl --fail --silent --show-error --max-time 5 \
        "https://$API_DOMAIN/health/ready" >/dev/null &&
        curl --fail --silent --show-error --max-time 5 \
          "https://$WEB_DOMAIN/" >/dev/null &&
        [[ -n "$(docker compose --env-file "$root/release.env" \
          -f "$root/compose.yaml" ps -q worker)" ]]; then
        worker_id=$(docker compose --env-file "$root/release.env" \
          -f "$root/compose.yaml" ps -q worker)
        if [[ "$(docker inspect --format '{{.State.Status}}' "$worker_id")" != running ]]; then
          sleep 2
          continue
        fi
        echo "Previous application image restored; database schema was not rolled back." >&2
        exit 1
      fi
      sleep 2
    done
  fi
  echo "Automatic rollback failed; inspect Docker Compose and health checks immediately." >&2
else
  echo "No previous application image is available for automatic rollback." >&2
fi

echo "Deployment failed; database schema is not rolled back automatically." >&2
exit 1
