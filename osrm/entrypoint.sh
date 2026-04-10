#!/bin/bash
set -e

DATA_DIR="/data"
PBF_FILE="$DATA_DIR/uzbekistan-latest.osm.pbf"
OSRM_FILE="$DATA_DIR/uzbekistan-latest.osrm"
PROFILE="/opt/car.lua"

# Download and process data only if not already done
if [ ! -f "$OSRM_FILE.cell_metrics" ]; then
  echo "=== OSRM: Downloading Uzbekistan OSM data ==="
  apt-get update -qq && apt-get install -y -qq wget > /dev/null 2>&1 || true
  apk add --no-cache wget > /dev/null 2>&1 || true

  wget -q -O "$PBF_FILE" \
    "https://download.geofabrik.de/asia/uzbekistan-latest.osm.pbf"

  echo "=== OSRM: Extracting road network ==="
  osrm-extract -p "$PROFILE" "$PBF_FILE"

  echo "=== OSRM: Partitioning ==="
  osrm-partition "$OSRM_FILE"

  echo "=== OSRM: Customizing ==="
  osrm-customize "$OSRM_FILE"

  # Clean up PBF to save space
  rm -f "$PBF_FILE"

  echo "=== OSRM: Data processing complete ==="
else
  echo "=== OSRM: Using existing processed data ==="
fi

echo "=== OSRM: Starting routing server on port 5000 ==="
exec osrm-routed --algorithm mld --port 5000 "$OSRM_FILE"
