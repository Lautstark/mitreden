#!/bin/sh
# Run mitreden on Linux: sh mitreden.sh
#
# Your sentences, config and audio files land in the folder this file sits in.
# While this terminal is open, mitreden runs; Ctrl-C stops the program and
# leaves everything else where it is.

cd "$(dirname "$0")" || exit 1
IMAGE=ghcr.io/steffipetaffy/mitreden:latest
PORT=${MITREDEN_PORT:-8770}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is missing. mitreden runs inside it."
  echo "  https://docs.docker.com/engine/install/"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but not reachable. Start the service"
  echo "(sudo systemctl start docker), then run this file again."
  exit 1
fi

# A second double-click should not spill a container error over the window.
if [ -n "$(docker ps -q -f name=^mitreden$)" ]; then
  echo "mitreden is already running at http://localhost:$PORT"
  (xdg-open "http://localhost:$PORT/" >/dev/null 2>&1 &)
  exit 0
fi
docker rm -f mitreden >/dev/null 2>&1   # a leftover from a crash

echo "Fetching mitreden (the first time this takes a few minutes) ..."
docker pull -q "$IMAGE" || exit 1

( for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    if curl -fs "http://localhost:$PORT/" >/dev/null 2>&1; then
      (xdg-open "http://localhost:$PORT/" >/dev/null 2>&1 &)
      break
    fi
  done ) &

echo
echo "mitreden is running at http://localhost:$PORT"
echo "Press Ctrl-C to stop it."
echo
docker run --rm --name mitreden -p "$PORT:8770" -v "$PWD:/data" "$IMAGE" || {
  echo
  echo "That did not start. Most often something else is using port $PORT."
  echo "You can pick another one:  MITREDEN_PORT=8790 ./$(basename "$0")"
  read -r _ 2>/dev/null
}
