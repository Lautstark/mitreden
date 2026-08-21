# mitreden auf einem NAS oder einem anderen Rechner, der durchläuft.
#
# Das Abbild bringt nur die Laufzeit mit — Python und ffmpeg. Das Projekt
# selbst wird als Verzeichnis hineingereicht, damit phrases.json, config.json
# und out/ auf dem NAS liegen und dort gesichert werden.

FROM python:3.12-slim

# ffmpeg schneidet die Stille und normalisiert die Lautheit. Ohne ffmpeg
# funktioniert nichts. Pip-Pakete braucht mitreden keine.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

# Ohne das puffert Python seine Ausgabe, sobald sie nicht im Terminal landet —
# "docker logs" bliebe dann leer, bis der Container aufhört.
ENV PYTHONUNBUFFERED=1

EXPOSE 8770
# Im Container muss auf allen Adressen gelauscht werden, sonst kommt die
# Portweiterleitung nicht durch. Nach außen begrenzt das die Portfreigabe.
CMD ["python", "mitreden.py", "ui", "--host", "0.0.0.0"]
