import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { SmilePlus } from "lucide-react";
import { useI18n } from "@web/shared/i18n.js";
import { TITLE_EMOJI_OPTIONS } from "@web/shared/title-emoji.js";
import { titleEditParts, titleIcon } from "@web/shared/utils/resource-title.js";
import "./resource-metadata.css";

function TitleIconPicker({
  current,
  onChange,
}: {
  current: string | null;
  onChange(icon: string | null): void;
}) {
  const { t } = useI18n(),
    root = useRef<HTMLDetailsElement>(null),
    [custom, setCustom] = useState("");
  const labelId = useId();
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && root.current)
        root.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const choose = (icon: string | null) => {
    onChange(icon);
    if (root.current) root.current.open = false;
    setCustom("");
    root.current?.parentElement
      ?.querySelector<HTMLInputElement>(':scope > input:not([type="hidden"])')
      ?.focus();
  };
  return (
    <details
      ref={root}
      className="title-icon-picker"
      onKeyDown={(event) => {
        if (event.key === "Escape" && root.current?.open) {
          event.preventDefault();
          event.stopPropagation();
          root.current.open = false;
          root.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary
        aria-label={t("titleIcon.choose")}
        title={t("titleIcon.choose")}
        aria-haspopup="dialog"
        onPointerDown={(event) => event.preventDefault()}
      >
        {current || <SmilePlus size={18} />}
      </summary>
      <div
        role="dialog"
        aria-labelledby={labelId}
        className="title-icon-popover"
      >
        <strong id={labelId}>{t("titleIcon.choose")}</strong>
        <div className="title-icon-grid">
          {TITLE_EMOJI_OPTIONS.map((icon) => (
            <button
              type="button"
              key={icon}
              title={icon}
              aria-label={icon}
              aria-pressed={current === icon}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(icon)}
            >
              {icon}
            </button>
          ))}
        </div>
        <div className="title-icon-custom">
          <input
            aria-label={t("titleIcon.custom")}
            placeholder={t("titleIcon.custom")}
            value={custom}
            maxLength={32}
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                const icon = titleIcon(custom.trim());
                if (icon) choose(icon);
              }
            }}
          />
          <button
            type="button"
            disabled={!titleIcon(custom.trim())}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => choose(titleIcon(custom.trim()))}
          >
            {t("titleIcon.apply")}
          </button>
        </div>
        <button
          type="button"
          className="title-icon-remove"
          disabled={!current}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => choose(null)}
        >
          {t("titleIcon.remove")}
        </button>
      </div>
    </details>
  );
}

export function TitleInput({
  value,
  onValueChange,
  name,
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange" | "defaultValue"> & {
  value: string;
  onValueChange(value: string): void;
}) {
  const parts = titleEditParts(value);
  return (
    <div className="resource-title-field">
      <TitleIconPicker
        current={parts.icon}
        onChange={(icon) =>
          onValueChange(icon ? `${icon} ${parts.text}` : parts.text)
        }
      />
      <input
        {...props}
        maxLength={
          props.maxLength === undefined
            ? undefined
            : Math.max(0, props.maxLength - parts.prefix.length)
        }
        value={parts.text}
        onChange={(event) => {
          const text = event.target.value;
          onValueChange(titleEditParts(text).icon ? text : parts.prefix + text);
        }}
      />
      {name && (
        <input
          type="hidden"
          name={name}
          value={value}
          disabled={props.disabled}
        />
      )}
    </div>
  );
}
