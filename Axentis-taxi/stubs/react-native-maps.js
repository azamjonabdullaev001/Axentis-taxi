// Web implementation — uses react-leaflet (OpenStreetMap tiles)
import React, { forwardRef, useImperativeHandle, useRef, useEffect } from 'react';
import { View } from 'react-native';
import { MapContainer, TileLayer, Marker as LMarker, Polyline as LPolyline, useMap } from 'react-leaflet';
import L from 'leaflet';

// Inject Leaflet CSS from CDN (avoids Metro CSS bundling issues)
function useLeafletCSS() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById('leaflet-css')) return;
    const link = document.createElement('link');
    link.id = 'leaflet-css';
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
  }, []);
}

// Fix broken default marker icons in bundled apps
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export const PROVIDER_GOOGLE = 'google';

function toLatLng(c) { return [c.latitude, c.longitude]; }
function deltaToZoom(d) { return Math.round(Math.log(360 / Math.max(d || 0.05, 0.001)) / Math.LN2); }

// Inner component — imperative map control via shared object
function MapController({ imperative }) {
  const map = useMap();
  useEffect(() => {
    imperative.flyTo = (lat, lng, zoom) =>
      map.flyTo([lat, lng], zoom, { animate: true, duration: 0.4 });
  });
  return null;
}

const MapView = forwardRef(function MapView(
  { children, style, region, initialRegion },
  ref
) {
  useLeafletCSS();
  const imperative = useRef({}).current;

  const init = region || initialRegion || {
    latitude: 41.2995, longitude: 69.2401, latitudeDelta: 0.05, longitudeDelta: 0.05,
  };

  useImperativeHandle(ref, () => ({
    animateToRegion: (r) =>
      imperative.flyTo?.(r.latitude, r.longitude, deltaToZoom(r.latitudeDelta)),
    animateCamera: ({ center: c, zoom: z } = {}) =>
      c && imperative.flyTo?.(c.latitude, c.longitude, z || 15),
  }));

  return (
    <View style={style}>
      <MapContainer
        center={toLatLng(init)}
        zoom={deltaToZoom(init.latitudeDelta)}
        style={{ width: '100%', height: '100%' }}
        zoomControl
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <MapController imperative={imperative} />
        {children}
      </MapContainer>
    </View>
  );
});

MapView.displayName = 'MapView';
export default MapView;

export function Marker({ coordinate, title }) {
  if (!coordinate) return null;
  return <LMarker position={toLatLng(coordinate)} title={title || ''} />;
}

export function Polyline({ coordinates, strokeColor, strokeWidth }) {
  if (!coordinates || coordinates.length < 2) return null;
  return (
    <LPolyline
      positions={coordinates.map(toLatLng)}
      pathOptions={{ color: strokeColor || '#FFCC00', weight: strokeWidth || 4 }}
    />
  );
}
