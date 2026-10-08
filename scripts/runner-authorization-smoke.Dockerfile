FROM node:24-bookworm-slim AS node
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends sudo libstdc++6 libatomic1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home da-runner
COPY --from=node /usr/local/bin/node /usr/bin/node
COPY deploy /root/provision/deploy
COPY release-step.sh smoke.sh /root/
CMD ["bash", "/root/smoke.sh"]
