# mitreden on a NAS, or any other machine that stays on.
#
# The image carries the runtime and nothing else — Python and ffmpeg. The
# project itself is mounted in, so phrases.json, config.json and out/ live on
# the NAS and end up in its backup.

FROM python:3.12-slim

# ffmpeg trims the silence and evens out the loudness. Nothing works without
# it. Pip packages mitreden needs none.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

# Without this Python buffers its output as soon as it is not a terminal, and
# `docker logs` stays empty until the container stops.
ENV PYTHONUNBUFFERED=1

EXPOSE 8770
# In a container it has to listen on every address, otherwise the port forward
# never reaches it. What gets out is decided by the published port.
CMD ["python", "mitreden.py", "ui", "--host", "0.0.0.0"]
