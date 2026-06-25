import { useId, useMemo } from "react";
import { EUROPE_COUNTRIES, canonicalCountry, completeOnTab, getRegionsForCountry } from "../utils/europeGeo";

export function GeoFields({
  values = {},
  onChange,
  countryField = "pais",
  regionField = "provincia",
  countryLabel = "Pais",
  regionLabel = "Provincia / region",
  inputStyle = {},
  labelStyle = {},
  disabled = false,
}) {
  const uid = useId().replace(/:/g, "");
  const currentCountry = canonicalCountry(values[countryField] || "Espana") || values[countryField] || "Espana";
  const currentRegion = values[regionField] || "";
  const countries = useMemo(() => {
    const list = [currentCountry, ...EUROPE_COUNTRIES].filter(Boolean);
    return Array.from(new Set(list));
  }, [currentCountry]);
  const regions = useMemo(() => getRegionsForCountry(currentCountry), [currentCountry]);

  const set = (field, value) => {
    if (typeof onChange === "function") onChange(field, value);
  };

  return (
    <>
      <div>
        <label style={labelStyle}>{regionLabel}</label>
        <input
          style={inputStyle}
          value={currentRegion}
          onChange={(e) => set(regionField, e.target.value)}
          onKeyDown={(e) => completeOnTab(e, regions, currentRegion, (value) => set(regionField, value))}
          list={`${uid}-regions`}
          placeholder={regions[0] || "Madrid"}
          disabled={disabled}
        />
        <datalist id={`${uid}-regions`}>
          {regions.map(region => <option key={region} value={region} />)}
        </datalist>
      </div>
      <div>
        <label style={labelStyle}>{countryLabel}</label>
        <input
          style={inputStyle}
          value={currentCountry}
          onChange={(e) => {
            const next = canonicalCountry(e.target.value) || e.target.value;
            set(countryField, next);
            if (next !== currentCountry) set(regionField, "");
          }}
          onKeyDown={(e) => completeOnTab(e, countries, currentCountry, (value) => set(countryField, value))}
          list={`${uid}-countries`}
          placeholder="Espana"
          disabled={disabled}
        />
        <datalist id={`${uid}-countries`}>
          {countries.map(country => <option key={country} value={country} />)}
        </datalist>
      </div>
    </>
  );
}
