import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { Network } from "@capacitor/network";

export function isNativeMobileApp() {
  try {
    return Boolean(Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

export function mobilePlatform() {
  try {
    return Capacitor?.getPlatform?.() || "web";
  } catch {
    return "web";
  }
}

export async function getNetworkStatus() {
  if (isNativeMobileApp()) {
    try {
      const status = await Network.getStatus();
      return { connected: Boolean(status.connected), connectionType: status.connectionType || "unknown" };
    } catch {}
  }
  return {
    connected: typeof navigator === "undefined" ? true : navigator.onLine !== false,
    connectionType: "web",
  };
}

export async function requestForegroundLocationPermission() {
  if (isNativeMobileApp()) {
    const status = await Geolocation.requestPermissions({ permissions: ["location"] });
    return status?.location === "granted" || status?.coarseLocation === "granted";
  }
  return true;
}

export async function getCurrentLocation(options = {}) {
  const opts = {
    enableHighAccuracy: options.enableHighAccuracy ?? true,
    timeout: options.timeout ?? 15000,
    maximumAge: options.maximumAge ?? 60000,
  };
  if (isNativeMobileApp()) {
    const pos = await Geolocation.getCurrentPosition(opts);
    return normalizePosition(pos);
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(normalizePosition(pos)),
      () => resolve(null),
      opts
    );
  });
}

export async function watchForegroundLocation(options, onPosition, onError) {
  const opts = {
    enableHighAccuracy: options?.enableHighAccuracy ?? true,
    timeout: options?.timeout ?? 15000,
    maximumAge: options?.maximumAge ?? 60000,
  };
  if (isNativeMobileApp()) {
    try {
      const id = await Geolocation.watchPosition(opts, (pos, err) => {
        if (err) {
          onError?.(err);
          return;
        }
        if (pos) onPosition?.(normalizePosition(pos));
      });
      return () => Geolocation.clearWatch({ id }).catch(() => {});
    } catch (err) {
      onError?.(err);
      return () => {};
    }
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    onError?.(new Error("GPS no disponible"));
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => onPosition?.(normalizePosition(pos)),
    (err) => onError?.(err),
    opts
  );
  return () => navigator.geolocation.clearWatch(id);
}

function normalizePosition(pos) {
  if (!pos?.coords) return null;
  return {
    lat: Number(pos.coords.latitude),
    lng: Number(pos.coords.longitude),
    accuracy_m: Number.isFinite(pos.coords.accuracy) ? Number(pos.coords.accuracy) : null,
    speed_mps: Number.isFinite(pos.coords.speed) ? Number(pos.coords.speed) : null,
    captured_at: new Date(pos.timestamp || Date.now()).toISOString(),
  };
}
