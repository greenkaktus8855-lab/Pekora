FROM node:20-bookworm-slim

# RCCService 2020 is a Windows executable. Wine runs it inside this Linux container.
RUN dpkg --add-architecture i386 \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
    ca-certificates git wine wine32:i386 wine64 \
    xvfb xauth netcat-openbsd \
    libgl1 libxrender1 libxext6 libsm6 libfontconfig1 fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/openpekora

# Fetch only the renderer and the matching RCCService 2020 files.
ARG OPENPEKORA_COMMIT=54c25c704a3c2cbecf5d3c79b823a43e492b30bf
RUN git init \
 && git remote add origin https://github.com/Blue7366/OpenPekora.git \
 && git sparse-checkout init --cone \
 && git sparse-checkout set game-renderer RCCService/RCCService2020 \
 && git fetch --depth=1 --filter=blob:none origin "${OPENPEKORA_COMMIT}" \
 && git checkout --detach FETCH_HEAD

COPY config.json /opt/openpekora/game-renderer/config.json
COPY patch-renderer.mjs /app/patch-renderer.mjs
COPY start.sh /app/start.sh

RUN node /app/patch-renderer.mjs \
 && cd /opt/openpekora/game-renderer \
 && npm install --no-audit --no-fund \
 && npm run build \
 && npm prune --omit=dev \
 && chmod +x /app/start.sh

ENV WINEDEBUG=-all
ENV WINEARCH=win32
ENV PORT=10000

EXPOSE 10000

CMD ["/bin/sh", "/app/start.sh"]
