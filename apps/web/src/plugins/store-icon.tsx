import { useState } from "react";
import { Package } from "lucide-react";
import "./store-icon.css";

export function PluginStoreIcon({
  pluginId,
  size = 20,
  icon,
}: {
  pluginId: string;
  size?: number;
  /** Catalog/detail responses already carry the validated store PNG. */
  icon?: string | null;
}) {
  const src =
    icon === undefined
      ? `/api/v1/plugin-icons/${encodeURIComponent(pluginId)}`
      : icon;
  const [loadedSource, setLoadedSource] = useState<string>();
  const [failedSource, setFailedSource] = useState<string>();
  const loaded = loadedSource === src && failedSource !== src;
  return (
    <span
      className="plugin-store-icon"
      style={{
        width: `var(--plugin-store-icon-size, ${size}px)`,
        height: `var(--plugin-store-icon-size, ${size}px)`,
      }}
      aria-hidden="true"
    >
      {!loaded && <Package size={size} />}
      {src && failedSource !== src && (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          hidden={!loaded}
          onLoad={() => setLoadedSource(src)}
          onError={() => setFailedSource(src)}
        />
      )}
    </span>
  );
}
