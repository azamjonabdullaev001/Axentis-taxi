FROM osrm/osrm-backend:latest

RUN apt-get update -qq && apt-get install -y -qq wget && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /data

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 5000

ENTRYPOINT ["/entrypoint.sh"]
