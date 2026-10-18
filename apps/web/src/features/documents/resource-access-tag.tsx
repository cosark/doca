import { useI18n } from "@web/shared/i18n.js";
import type { Resource } from "@web/shared/api.js";
import "./resource-metadata.css";

export function ResourceAccessTag({
  state,
}: {
  state: Resource["access_state"];
}) {
  const { t } = useI18n();
  if (!state) return null;
  return (
    <span
      className={`resource-access-tag is-${state}`}
      data-access-state={state}
      title={t(`resourceAccess.${state}Hint`)}
    >
      {t(`resourceAccess.${state}`)}
    </span>
  );
}
