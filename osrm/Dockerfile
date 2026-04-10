FROM debian:bookworm-slim AS tools
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM osrm/osrm-backend:latest

COPY --from=tools /usr/bin/wget /usr/bin/wget
COPY --from=tools /etc/ssl/certs /etc/ssl/certs

RUN mkdir -p /data

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 5000

ENTRYPOINT ["/entrypoint.sh"]
