# mitreden on a NAS, or any other machine that stays on.
#
# The image carries the program and its runtime — Python, ffmpeg, mitreden.py.
# Only your data is mounted in, at /data: phrases.json, config.json, out/ and
# the .env with the key. Those live on the NAS and end up in its backup, while
# the code comes from the image and updates by pulling a new one.

FROM python:3.12-slim

# ffmpeg trims the silence and evens out the loudness. Nothing works without
# it. Outside the container mitreden needs no pip packages at all; in here
# piper is the one exception, and it is what makes the image speak without an
# account anywhere.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl \
 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir piper-tts

# Two German voices, one male and one female, both CC0 — so they may travel
# in a public image. A model is only usable together with its .onnx.json.
# Drop further .onnx files into voices/ next to your phrases to add your own.
ENV MITREDEN_VOICES=/voices
RUN mkdir -p /voices && cd /voices \
 && base=https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE \
 && for v in thorsten/medium/de_DE-thorsten-medium kerstin/low/de_DE-kerstin-low; do \
      n=$(basename $v); \
      curl -sfL -o $n.onnx      "$base/$v.onnx"; \
      curl -sfL -o $n.onnx.json "$base/$v.onnx.json"; \
    done \
 && ls -l /voices

WORKDIR /app
COPY . .

# Without this Python buffers its output as soon as it is not a terminal, and
# `docker logs` stays empty until the container stops.
ENV PYTHONUNBUFFERED=1

# Your phrases live here, not next to the code — mount this and nothing else.
# Mounting over /app would hide the program itself.
ENV MITREDEN_DIR=/data
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8770
# In a container it has to listen on every address, otherwise the port forward
# never reaches it. What gets out is decided by the published port.
CMD ["python", "mitreden.py", "ui", "--host", "0.0.0.0"]
