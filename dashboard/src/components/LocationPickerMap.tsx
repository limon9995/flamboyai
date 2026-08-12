import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Dhaka center — sensible default when no pin exists yet
const DEFAULT_CENTER: [number, number] = [23.8103, 90.4125];

// Emoji divIcons — avoids Leaflet's default marker images 404-ing under Vite
function emojiIcon(emoji: string, size: number) {
  return L.divIcon({
    className: '',
    html: `<div style="font-size:${size}px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))">${emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size - 2],
  });
}

interface LocationPickerMapProps {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
  height?: number;
  markerEmoji?: string;
  /** Fixed reference marker (e.g. the restaurant pin when picking a customer location) */
  referencePin?: { lat: number; lng: number; emoji?: string } | null;
  /** Radius circle around referencePin (or the marker itself), in km */
  radiusKm?: number | null;
}

export default function LocationPickerMap({
  lat,
  lng,
  onChange,
  height = 260,
  markerEmoji = '📍',
  referencePin = null,
  radiusKm = null,
}: LocationPickerMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsError, setGpsError] = useState('');
  // Any user-driven pin change (GPS, click, drag) asks for an explicit
  // confirm before treating the spot as settled — GPS in particular can be
  // off by a lot, so we show the pin and wait for a "yes this is right"
  // rather than silently trusting it.
  const [confirmPending, setConfirmPending] = useState(false);
  const [justConfirmed, setJustConfirmed] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markPending = () => {
    setJustConfirmed(false);
    setConfirmPending(true);
  };
  const confirmLocation = () => {
    setConfirmPending(false);
    setJustConfirmed(true);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => setJustConfirmed(false), 5000);
  };
  useEffect(() => () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); }, []);

  const placeMarker = (map: L.Map, la: number, ln: number) => {
    if (!markerRef.current) {
      markerRef.current = L.marker([la, ln], {
        icon: emojiIcon(markerEmoji, 30),
        draggable: true,
      }).addTo(map);
      markerRef.current.on('dragend', () => {
        const ll = markerRef.current!.getLatLng();
        onChangeRef.current(ll.lat, ll.lng);
        markPending();
      });
    } else {
      markerRef.current.setLatLng([la, ln]);
    }
  };

  // Init once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const center: [number, number] =
      lat != null && lng != null
        ? [lat, lng]
        : referencePin
          ? [referencePin.lat, referencePin.lng]
          : DEFAULT_CENTER;
    const map = L.map(containerRef.current).setView(center, lat != null ? 15 : 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    if (referencePin) {
      L.marker([referencePin.lat, referencePin.lng], {
        icon: emojiIcon(referencePin.emoji || '🏪', 26),
        interactive: false,
      }).addTo(map);
    }
    map.on('click', (e: L.LeafletMouseEvent) => {
      placeMarker(map, e.latlng.lat, e.latlng.lng);
      onChangeRef.current(e.latlng.lat, e.latlng.lng);
      markPending();
    });
    if (lat != null && lng != null) placeMarker(map, lat, lng);
    mapRef.current = map;
    // Container may have just become visible (modal/section toggle)
    setTimeout(() => map.invalidateSize(), 80);
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep marker in sync when parent state changes (e.g. loaded from server)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || lat == null || lng == null) return;
    placeMarker(map, lat, lng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  // Radius circle around the reference pin (or the picked point)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (circleRef.current) {
      circleRef.current.remove();
      circleRef.current = null;
    }
    const centerPt = referencePin
      ? [referencePin.lat, referencePin.lng]
      : lat != null && lng != null
        ? [lat, lng]
        : null;
    if (radiusKm && radiusKm > 0 && centerPt) {
      circleRef.current = L.circle(centerPt as [number, number], {
        radius: radiusKm * 1000,
        color: '#059669',
        weight: 1.5,
        fillOpacity: 0.06,
      }).addTo(map);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radiusKm, referencePin?.lat, referencePin?.lng, lat, lng]);

  const useGps = () => {
    if (!navigator.geolocation) {
      setGpsError('এই browser-এ GPS support নেই — ম্যাপে ক্লিক করে pin করুন');
      return;
    }
    setGpsBusy(true);
    setGpsError('');
    // Watchdog: some browsers/WebViews never fire either native callback even
    // with {timeout} set, leaving the button stuck on "খোঁজা হচ্ছে..." forever.
    let done = false;
    const watchdog = setTimeout(() => {
      if (done) return;
      done = true;
      setGpsBusy(false);
      setGpsError('লোকেশন পেতে বেশি সময় লাগছে — ম্যাপে ক্লিক করে pin করুন');
    }, 12000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (done) return;
        done = true; clearTimeout(watchdog);
        setGpsBusy(false);
        const { latitude, longitude } = pos.coords;
        mapRef.current?.setView([latitude, longitude], 16);
        if (mapRef.current) placeMarker(mapRef.current, latitude, longitude);
        onChangeRef.current(latitude, longitude);
        markPending();
      },
      () => {
        if (done) return;
        done = true; clearTimeout(watchdog);
        setGpsBusy(false);
        setGpsError('লোকেশন পাওয়া যায়নি — location permission দিন অথবা ম্যাপে ক্লিক করুন');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div>
      <div
        ref={containerRef}
        style={{
          height,
          borderRadius: 12,
          overflow: 'hidden',
          border: '1px solid var(--border, #e5e7eb)',
          zIndex: 1,
          position: 'relative',
        }}
      />
      <button
        type="button"
        onClick={useGps}
        disabled={gpsBusy}
        style={{
          marginTop: 8,
          width: '100%',
          padding: '9px 12px',
          borderRadius: 10,
          border: '1px solid #059669',
          background: 'rgba(5,150,105,.08)',
          color: '#059669',
          fontSize: 13,
          fontWeight: 700,
          cursor: gpsBusy ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {gpsBusy ? 'লোকেশন খোঁজা হচ্ছে...' : '📍 আমার বর্তমান লোকেশন ব্যবহার করুন (GPS)'}
      </button>
      {gpsError && (
        <div style={{ marginTop: 6, fontSize: 12.5, color: '#dc2626' }}>{gpsError}</div>
      )}
      {confirmPending && (
        <div style={{
          marginTop: 8, padding: '9px 12px', borderRadius: 10,
          background: 'rgba(217,119,6,.1)', border: '1px solid #d97706',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 12.5, color: '#b45309', fontWeight: 600 }}>
            📍 ম্যাপে pin-টা কি ঠিক জায়গায় আছে? ভুল হলে ম্যাপে ক্লিক করে বা পিন ড্র্যাগ করে ঠিক করুন।
          </span>
          <button
            type="button"
            onClick={confirmLocation}
            style={{
              padding: '6px 12px', borderRadius: 8, border: 'none',
              background: '#d97706', color: '#fff', fontSize: 12.5, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}
          >
            ✅ হ্যাঁ, ঠিক আছে
          </button>
        </div>
      )}
      {justConfirmed && !confirmPending && (
        <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(5,150,105,.1)', border: '1px solid #059669', fontSize: 12.5, color: '#059669', fontWeight: 700 }}>
          ✅ লোকেশন যোগ করা হয়েছে — এবার নিচের Save বাটনে চাপ দিয়ে সেভ করুন। পরে চাইলে আবার পিন সরিয়ে বদলাতে পারবেন।
        </div>
      )}
    </div>
  );
}
