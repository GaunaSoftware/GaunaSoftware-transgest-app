import { useCallback } from "react";
import { actualizarKmVehiculo } from "../services/api";

/**
 * useKmUpdate - shared hook that dispatches a km update to the API
 * whenever km changes anywhere in the app.
 * Usage:
 *   const { updateKm } = useKmUpdate();
 *   updateKm(vehiculo_id, nuevo_km);
 */
export function useKmUpdate() {
  const updateKm = useCallback(async (vehiculoId, km) => {
    if (!vehiculoId || !km || isNaN(Number(km)) || Number(km) <= 0) return;
    try {
      await actualizarKmVehiculo(vehiculoId, Number(km));
      // Dispatch custom event so other components can react (e.g. avisos)
      window.dispatchEvent(new CustomEvent("tms:km_updated", {
        detail: { vehiculoId, km: Number(km) }
      }));
    } catch(e) {
      console.warn("updateKm error:", e.message);
    }
  }, []);

  return { updateKm };
}
