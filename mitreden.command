#!/bin/sh
# Double-click this to run mitreden on a Mac.
#
# Your sentences, config and audio files land in the folder this file sits in.
# While this window is open, mitreden runs; closing it stops the program and
# leaves everything else where it is.

cd "$(dirname "$0")" || exit 1
IMAGE=ghcr.io/steffipetaffy/mitreden:latest
PORT=${MITREDEN_PORT:-8770}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is missing. mitreden runs inside it."
  echo "Get it here, then start this file again:"
  echo "  https://www.docker.com/products/docker-desktop/"
  echo
  read -r _ 2>/dev/null
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but not running. Start Docker Desktop,"
  echo "wait until its whale icon stops moving, then start this file again."
  echo
  read -r _ 2>/dev/null
  exit 1
fi

# A second double-click should not spill a container error over the window.
if [ -n "$(docker ps -q -f name=^mitreden$)" ]; then
  echo "mitreden is already running at http://localhost:$PORT"
  open "http://localhost:$PORT/"
  exit 0
fi
docker rm -f mitreden >/dev/null 2>&1   # a leftover from a crash

echo "Fetching mitreden (the first time this takes a few minutes) ..."
docker pull -q "$IMAGE" || exit 1

# Open the browser once the server answers, not before.
( for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    if curl -fs "http://localhost:$PORT/" >/dev/null 2>&1; then
      open "http://localhost:$PORT/"
      break
    fi
  done ) &

echo
echo "mitreden is running at http://localhost:$PORT"
echo "Close this window to stop it."
echo
docker run --rm --name mitreden -p "$PORT:8770" -v "$PWD:/data" "$IMAGE" || {
  echo
  echo "That did not start. Most often something else is using port $PORT."
  echo "You can pick another one:  MITREDEN_PORT=8790 ./$(basename "$0")"
  read -r _ 2>/dev/null
}
