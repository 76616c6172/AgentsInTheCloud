#!/usr/bin/env bash
# Run from the repository: bash scripts/nox-deploy.sh root@server release.json --yes
# Uses the existing installation, not the upstream installer's channel update.
set -Eeuo pipefail
if [[ $# != 3 || $3 != --yes ]]; then
  printf 'Usage: bash scripts/nox-deploy.sh root@server release.json --yes\nRequires local Bun + SSH; remote root + Docker + tar. Stops running workspaces.\nCreates a full, private, disk-backed backup and an image rollback script on the server.\n'
  exit 1
fi
host=$1
[[ "$host" =~ ^[a-zA-Z0-9_.@:-]+$ && "$host" != -* ]] || { echo 'Invalid SSH destination' >&2; exit 1; }
cd "$(dirname "$0")/.."
mapfile -t release < <(bun -e 'import {parseNoxRelease} from "./scripts/nox-release.ts"; const r=parseNoxRelease(await Bun.file(process.argv[1]).text()); console.log([r.revision,r.app,r.system,r.workspace].join("\n"));' "$2")
[[ ${#release[@]} == 4 ]] || { echo 'Invalid release manifest' >&2; exit 1; }
ssh "$host" bash -s -- "${release[@]}" <<'REMOTE'
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 ]] || { echo 'Deployment requires root' >&2; exit 1; }
revision=$1; app=$2; system=$3; workspace=$4
name=agents-in-the-cloud-system
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="/var/backups/agents-in-the-cloud/${stamp}-${revision:0:12}"
mkdir -p "$backup"
printf 'Deployment record and backup: %s\n' "$backup"
trap 'printf "Deployment stopped at line %s. Inspect %s; rollback.sh restores the previous images without restoring older data.\n" "$LINENO" "$backup" >&2' ERR
docker inspect "$name" > "$backup/system-container.json"
previous_system=$(docker inspect --format '{{.Image}}' "$name")
previous_app=$(docker exec "$name" docker inspect --format '{{.Image}}' agents-in-the-cloud)
volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$name")
[[ "$volume" == agents-in-the-cloud-system ]] || { echo 'Unexpected installation volume' >&2; exit 1; }
source=$(docker volume inspect --format '{{.Mountpoint}}' "$volume")
local_port=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "3080/tcp") 0).HostPort}}' "$name")
[[ "$local_port" =~ ^[0-9]+$ ]] || { echo 'Missing local ingress port' >&2; exit 1; }
[[ $(docker info --format '{{.Architecture}}') == x86_64 ]] || { echo 'This release requires amd64' >&2; exit 1; }

docker pull "$system"
docker exec "$name" docker pull "$app"
docker exec "$name" docker pull "$workspace"
# Keep the old app and its workspace dependencies reachable through image pruning.
docker exec "$name" bun -e '
  const run=(args)=>{const p=Bun.spawnSync(["docker",...args]);if(p.exitCode)throw new Error(p.stderr.toString());return p.stdout.toString().trim()};
  const image=JSON.parse(run(["image","inspect",process.argv[1]]))[0];
  const refs=[process.argv[1],...JSON.parse(image.Config.Labels["eagerly-preload"])];
  refs.forEach((ref,i)=>run(["create","--name",`nox-rollback-${process.argv[2]}-${i}`,"--entrypoint","/bin/true",ref]));
' "$previous_app" "$stamp"
expected_app=$(docker exec "$name" docker image inspect --format '{{.Id}}' "$app")
printf '%s\n' "$revision" "$app" "$system" "$workspace" > "$backup/release.txt"
printf '%s\n' "$previous_system" "$previous_app" > "$backup/previous-images.txt"

start_system() {
  docker run -d --name "$name" --hostname agents-in-the-cloud-system --privileged --cgroupns=host \
    --restart unless-stopped --stop-timeout 120 --tmpfs /run \
    --mount source=agents-in-the-cloud-system,target=/data --publish "127.0.0.1:$local_port:3080" "$1"
}
wait_idle() {
  for ((attempt=0; attempt<240; attempt++)); do
    if docker exec "$name" bun -e 'const r=await fetch("http://127.0.0.1:3001/status");const s=await r.json();process.exit(s.busy || !["ready","failed"].includes(s.state) ? 1 : 0)' 2>/dev/null; then return; fi
    sleep 2
  done
  docker logs --tail 50 "$name" >&2
  return 1
}
select_app() {
  docker exec "$name" bun -e 'const r=await fetch("http://127.0.0.1:3001/update",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({image:process.argv[1]})});if(r.status!==202)throw new Error(`${r.status}: ${await r.text()}`);' "$1"
}
wait_ready() {
  for ((attempt=0; attempt<240; attempt++)); do
    if docker exec "$name" bun -e 'const s=await(await fetch("http://127.0.0.1:3001/status")).json();if(s.state==="failed"){console.error(JSON.stringify(s));process.exit(2)}process.exit(s.healthy && !s.busy && s.currentImage===process.argv[1] ? 0 : 1)' "$1"; then return; fi
    sleep 2
  done
  docker logs --tail 50 "$name" >&2
  return 1
}
# Store a runnable, version-specific rollback outside the installation volume.
{
  printf '#!/usr/bin/env bash\nset -Eeuo pipefail\n'
  printf 'name=%q\nlocal_port=%q\nprevious_system=%q\nprevious_app=%q\n' "$name" "$local_port" "$previous_system" "$previous_app"
  declare -f start_system wait_idle select_app wait_ready
  printf 'docker stop --time 120 "$name"\ndocker rm "$name"\nstart_system "$previous_system"\nwait_idle\nselect_app "$previous_app"\nwait_ready "$previous_app"\n'
} > "$backup/rollback.sh"
chmod 700 "$backup/rollback.sh"
# Refuse before stopping if the backup cannot fit on its destination filesystem.
needed=$(du -s -B1 "$source" | cut -f1)
available=$(df -B1 --output=avail "$backup" | tail -1)
(( available > needed + 2147483648 )) || { echo 'Insufficient backup disk space' >&2; exit 1; }
echo 'Stopping System for a consistent full-volume backup.'
docker stop --time 120 "$name"
if ! tar --sparse --xattrs --acls -cpf "$backup/data.tar" -C "$source" .; then
  echo 'Backup failed; restarting the existing installation.' >&2
  docker start "$name"
  exit 1
fi
sha256sum "$backup/data.tar" > "$backup/data.tar.sha256"
docker rm "$name"
start_system "$system"
wait_idle
select_app "$app"
wait_ready "$expected_app"
docker exec "$name" bun -e 'const {logs,...s}=await(await fetch("http://127.0.0.1:3001/status")).json();console.log(JSON.stringify(s,null,2))' > "$backup/deployed-status.json"
printf 'Deployment healthy. Backup: %s\nImage rollback: bash %s/rollback.sh\n' "$backup" "$backup"
REMOTE
