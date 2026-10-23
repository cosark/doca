import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Copy,
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { useI18n } from "@web/shared/i18n.js";
import { downloadUrl, type PreviewSource } from "./document-file-preview.js";
import "./document-image-preview.css";

const clamp = (value: number) => Math.max(0.2, Math.min(5, value));

/** One click-time media occurrence. URLs and resolvers are never document data. */
export type DocumentImageSource = Omit<PreviewSource, "url"> & {
  id?: string;
  url?: string;
  resolveUrl?: () => string | Promise<string>;
  /** The host supplies its original-byte authorization path separately. */
  downloadUrl?: string;
};

export function imageDownloadUrl(
  file: DocumentImageSource,
  displayUrl: string,
) {
  if (file.downloadUrl) return file.downloadUrl;
  return /^(data:|blob:)/i.test(displayUrl)
    ? displayUrl
    : downloadUrl(displayUrl);
}

/** Canvas images use the same lightbox presentation as the rich-text editor. */
export function DocumentImagePreview({
  file,
  gallery = [],
  initialIndex,
  close,
}: {
  file: DocumentImageSource;
  gallery?: readonly DocumentImageSource[];
  initialIndex?: number;
  close(): void;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null),
    viewport = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1),
    [error, setError] = useState("");
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const images = gallery.length ? gallery : [file];
  const [index, setIndex] = useState(() =>
    initialIndex != null && initialIndex >= 0 && initialIndex < images.length
      ? initialIndex
      : Math.max(
          0,
          images.findIndex(
            (item) =>
              item === file ||
              (file.id ? item.id === file.id : item.url === file.url),
          ),
        ),
  );
  const currentFile = images[index] ?? file;
  const [resolved, setResolved] = useState<{
    file: DocumentImageSource;
    url: string;
  } | null>(null);
  const displayUrl =
    resolved?.file === currentFile ? resolved.url : (currentFile.url ?? "");
  useEffect(() => {
    let active = true;
    setError("");
    if (currentFile.resolveUrl) {
      Promise.resolve()
        .then(() => currentFile.resolveUrl!())
        .then((url) => {
          if (!url) throw new Error("IMAGE_PREVIEW_UNAVAILABLE");
          if (active) setResolved({ file: currentFile, url });
        })
        .catch(() => {
          if (active) setError(t("doc.imageLoadFailed"));
        });
    }
    return () => {
      active = false;
    };
  }, [currentFile, t]);
  const navigate = useCallback(
    (direction: number) => {
      setIndex((value) =>
        Math.max(0, Math.min(images.length - 1, value + direction)),
      );
      setError("");
      setScale(1);
      setOffset({ x: 0, y: 0 });
      drag.current = undefined;
      // The clicked previous/next button may become disabled at an endpoint.
      // Keep keyboard navigation inside the dialog after that focus change.
      root.current?.focus({ preventScroll: true });
    },
    [images.length],
  );
  const navigation = useRef(navigate);
  navigation.current = navigate;
  const drag = useRef<
    | { x: number; y: number; left: number; top: number; swipe: boolean }
    | undefined
  >(undefined);
  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);
  useEffect(() => {
    const previous = document.activeElement;
    root.current?.focus({ preventScroll: true });
    let horizontal = 0;
    let lastWheel = 0;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        if (event.timeStamp - lastWheel > 250) horizontal = 0;
        horizontal += event.deltaX;
        lastWheel = event.timeStamp;
        if (Math.abs(horizontal) >= 100) {
          navigation.current(horizontal > 0 ? 1 : -1);
          horizontal = 0;
        }
        return;
      }
      setScale((value) => clamp(value + (event.deltaY < 0 ? 0.12 : -0.12)));
    };
    const element = viewport.current;
    element?.addEventListener("wheel", wheel, { passive: false });
    return () => {
      element?.removeEventListener("wheel", wheel);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  const copy = () => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      setError(t("doc.imageCopyFailed"));
      return;
    }
    setError("");
    // Download authorization is checked again for clipboard bytes.
    if (!displayUrl) return;
    const png = fetch(imageDownloadUrl(currentFile, displayUrl)).then(
      async (response) => {
        if (!response.ok) throw new Error("IMAGE_COPY_DENIED");
        const blob = await response.blob();
        if (blob.type === "image/png") return blob;
        // Chromium's createImageBitmap cannot decode every generated SVG.
        // Decode through the browser's image renderer after the original-byte
        // request succeeds, without falling back around download authorization.
        const source =
          blob.type.includes("svg") &&
          /^data:image\/svg\+xml[;,]/i.test(displayUrl)
            ? displayUrl
            : URL.createObjectURL(blob);
        try {
          const picture = await new Promise<HTMLImageElement>(
            (resolve, reject) => {
              const image = new Image();
              image.onload = () => resolve(image);
              image.onerror = () => reject(new Error("IMAGE_COPY_FAILED"));
              image.src = source;
            },
          );
          if (!picture.naturalWidth || !picture.naturalHeight)
            throw new Error("IMAGE_COPY_FAILED");
          const canvas = document.createElement("canvas");
          canvas.width = picture.naturalWidth;
          canvas.height = picture.naturalHeight;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("IMAGE_COPY_FAILED");
          context.drawImage(picture, 0, 0);
          return await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (result) =>
                result
                  ? resolve(result)
                  : reject(new Error("IMAGE_COPY_FAILED")),
              "image/png",
            ),
          );
        } finally {
          if (source.startsWith("blob:")) URL.revokeObjectURL(source);
        }
      },
    );
    void navigator.clipboard
      .write([new ClipboardItem({ "image/png": png })])
      .catch(() => setError(t("doc.imageCopyFailed")));
  };
  return createPortal(
    <div
      ref={root}
      className="document-image-preview"
      role="dialog"
      aria-modal="true"
      aria-label={currentFile.name}
      tabIndex={-1}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          ["Escape", "+", "=", "-", "0", "ArrowLeft", "ArrowRight"].includes(
            event.key,
          )
        )
          event.preventDefault();
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
        if (event.key === "+" || event.key === "=")
          setScale((value) => clamp(value + 0.2));
        if (event.key === "-") setScale((value) => clamp(value - 0.2));
        if (event.key === "0") reset();
        if (event.key === "ArrowLeft") navigate(-1);
        if (event.key === "ArrowRight") navigate(1);
        if (event.key === "Tab") {
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled),a[href]",
            ),
          );
          const index = controls.indexOf(document.activeElement as HTMLElement);
          event.preventDefault();
          controls[
            (index + (event.shiftKey ? -1 : 1) + controls.length) %
              controls.length
          ]?.focus();
        }
      }}
    >
      <div
        className="document-image-preview-toolbar"
        role="toolbar"
        aria-label={t("doc.imagePreview")}
      >
        <button
          aria-label={t("books.zoomOut")}
          title={t("books.zoomOut")}
          onClick={() => setScale((value) => clamp(value - 0.2))}
        >
          <Minus size={18} />
        </button>
        <button
          className="document-image-preview-scale"
          aria-label={t("doc.imageReset")}
          onClick={reset}
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          aria-label={t("books.zoomIn")}
          title={t("books.zoomIn")}
          onClick={() => setScale((value) => clamp(value + 0.2))}
        >
          <Plus size={18} />
        </button>
        <button
          aria-label={t("doc.imageFit")}
          title={t("doc.imageFit")}
          onClick={reset}
        >
          <Maximize2 size={18} />
        </button>
        <button
          aria-label={t("doc.imageReset")}
          title={t("doc.imageReset")}
          onClick={reset}
        >
          <RotateCcw size={17} />
        </button>
        <button
          aria-label={t("doc.imageCopy")}
          title={t("doc.imageCopy")}
          disabled={!displayUrl}
          onClick={copy}
        >
          <Copy size={18} />
        </button>
        <a
          href={
            displayUrl ? imageDownloadUrl(currentFile, displayUrl) : undefined
          }
          download={currentFile.name}
          aria-label={t("doc.download")}
          title={t("doc.download")}
        >
          <Download size={18} />
        </a>
        <button
          aria-label={t("dialog.close")}
          title={t("dialog.close")}
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {images.length > 1 && (
        <>
          <button
            className="document-image-preview-previous"
            aria-label={t("doc.imagePrevious")}
            disabled={index === 0}
            onClick={() => navigate(-1)}
          >
            <ChevronLeft size={26} />
          </button>
          <span className="document-image-preview-position" role="status">
            {t("doc.imagePosition", { index: index + 1, count: images.length })}
          </span>
          <button
            className="document-image-preview-next"
            aria-label={t("doc.imageNext")}
            disabled={index >= images.length - 1}
            onClick={() => navigate(1)}
          >
            <ChevronRight size={26} />
          </button>
        </>
      )}
      <div
        ref={viewport}
        className="document-image-preview-viewport"
        aria-busy={!displayUrl && !error}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <img
          hidden={!displayUrl}
          src={displayUrl || undefined}
          alt={currentFile.name}
          draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          }}
          onLoad={() => setError("")}
          onError={() => setError(t("doc.imageLoadFailed"))}
          onDoubleClick={reset}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            root.current?.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              x: event.clientX,
              y: event.clientY,
              left: offset.x,
              top: offset.y,
              swipe:
                event.pointerType === "touch" &&
                scale === 1 &&
                offset.x === 0 &&
                offset.y === 0,
            };
          }}
          onPointerMove={(event) => {
            const current = drag.current;
            if (current)
              setOffset({
                x: current.left + event.clientX - current.x,
                y: current.top + event.clientY - current.y,
              });
          }}
          onPointerUp={(event) => {
            const current = drag.current;
            if (current?.swipe) {
              const x = event.clientX - current.x,
                y = event.clientY - current.y;
              if (Math.abs(x) > 60 && Math.abs(x) > 2 * Math.abs(y)) {
                navigate(x < 0 ? 1 : -1);
              }
            }
            drag.current = undefined;
          }}
          onPointerCancel={() => {
            drag.current = undefined;
          }}
        />
        {!displayUrl && !error && (
          <span role="status">{t("trash.loadingPreview")}</span>
        )}
      </div>
      {error && (
        <div className="document-image-preview-error" role="alert">
          {error}
        </div>
      )}
    </div>,
    document.body,
  );
}
