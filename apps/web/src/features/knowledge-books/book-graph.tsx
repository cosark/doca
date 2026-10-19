import { Graph } from "@antv/x6";
import type { Edge, Node } from "@antv/x6";
import { useEffect, useRef, useState } from "react";
import { Button, Tooltip } from "antd";
import {
  Maximize2,
  Minimize2,
  Scan,
  Plus,
  Minus,
  Workflow,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelTopClose,
  PanelTopOpen,
  MoveHorizontal,
  BookOpen,
  MessageSquareText,
  ScanText,
  PenLine,
  ListTree,
  ShieldCheck,
  UserRoundCheck,
  Send,
  type LucideIcon,
} from "lucide-react";
import type {
  BookWorkflow,
  BookNodeType,
  ProvenanceNode,
  ProvenanceEdge,
} from "@core/modules/knowledge-books/protocol.js";
import { useI18n } from "@web/shared/i18n.js";
import { fromMarkdown } from "mdast-util-from-markdown";

function plainLabel(markdown: string) {
  const text = (node: { value?: string; children?: unknown[] }): string =>
    node.value ??
    (node.children ?? [])
      .map((child) => text(child as Parameters<typeof text>[0]))
      .join(" ");
  return text(fromMarkdown(markdown)).replace(/\s+/g, " ").trim();
}

// The palette and canvas use the same Lucide silhouettes at every zoom level.
const nodeAppearance: Record<
  BookNodeType,
  {
    icon: LucideIcon;
    path: string;
    color: string;
    fill: string;
    group: "inputs" | "models" | "checks";
  }
> = {
  sources: {
    icon: BookOpen,
    path: "M12 7v14m0-14C9 5 5 5 2 6v14c3-1 7-1 10 1m0-14c3-2 7-2 10-1v14c-3-1-7-1-10 1",
    color: "#465fce",
    fill: "#f0f2fc",
    group: "inputs",
  },
  feedback: {
    icon: MessageSquareText,
    path: "M21 15a3 3 0 0 1-3 3H7l-5 4V5a3 3 0 0 1 3-3h13a3 3 0 0 1 3 3v10M7 7h9M7 12h6",
    color: "#247b79",
    fill: "#eef8f6",
    group: "inputs",
  },
  extract: {
    icon: ScanText,
    path: "M4 7V4h3m10 0h3v3m0 10v3h-3M7 20H4v-3M8 8h8M8 12h8M8 16h5",
    color: "#7054bb",
    fill: "#f4f0fa",
    group: "models",
  },
  synthesize: {
    icon: PenLine,
    path: "m15 5 4 4M4 20h16M5 15 16 4a2.8 2.8 0 0 1 4 4L9 19H5v-4",
    color: "#7054bb",
    fill: "#f4f0fa",
    group: "models",
  },
  organize: {
    icon: ListTree,
    path: "M4 3v12a3 3 0 0 0 3 3h3M4 7h6m4 0h6m-6 11h6",
    color: "#465fce",
    fill: "#f0f2fc",
    group: "models",
  },
  acceptance: {
    icon: ShieldCheck,
    path: "M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4m-5 10 3 3 6-6",
    color: "#997021",
    fill: "#fcf6e9",
    group: "checks",
  },
  human_review: {
    icon: UserRoundCheck,
    path: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8m8 9 2 2 4-4",
    color: "#997021",
    fill: "#fcf6e9",
    group: "checks",
  },
  publish: {
    icon: Send,
    path: "m22 2-7 20-4-9L2 9 22 2ZM11 13 22 2",
    color: "#287b60",
    fill: "#edf7f1",
    group: "checks",
  },
};

/** X6 is also the diagram engine used by the installed slatetsx editor. */
export function BookGraph({
  workflow,
  provenance,
  editable = false,
  changed,
  selected,
  dismissed,
  added,
  execution,
}: {
  execution?: {
    viewId: string;
    states: Readonly<Record<string, string>>;
    summaries: Readonly<Record<string, string>>;
    selectedId?: string;
  };
  workflow?: BookWorkflow;
  provenance?: { nodes: ProvenanceNode[]; edges: ProvenanceEdge[] };
  editable?: boolean;
  changed?: (value: BookWorkflow) => void;
  selected?: (id: string) => void;
  dismissed?: () => void;
  added?: (type: BookNodeType, position: { x: number; y: number }) => void;
}) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null),
    graph = useRef<Graph | null>(null);
  const callbacks = useRef({ changed, selected, dismissed, workflow });
  callbacks.current = { changed, selected, dismissed, workflow };
  const syncing = useRef(false),
    fitted = useRef(false),
    selectedId = useRef<string | null>(null);
  const rendered = useRef(new Map<string, string>());
  const viewedExecution = useRef<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false),
    [zoom, setZoom] = useState(100),
    [paletteVisible, setPaletteVisible] = useState(true),
    [toolbarVisible, setToolbarVisible] = useState(true);
  const isProvenance = !!provenance;
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded]);
  useEffect(() => {
    if (!host.current) return;
    const canvas: Graph = new Graph({
      container: host.current,
      autoResize: true,
      grid: {
        visible: true,
        size: 20,
        type: "dot",
        args: { color: "#dce1e9", thickness: 1 },
      },
      virtual: isProvenance,
      panning: true,
      scaling: { min: 0.08, max: 2 },
      mousewheel: { enabled: true, modifiers: ["ctrl", "meta"] },
      interacting: editable ? { edgeLabelMovable: false } : false,
      connecting: {
        allowBlank: false,
        allowLoop: false,
        allowMulti: false,
        allowEdge: false,
        snap: true,
        highlight: true,
        connector: { name: "smooth", args: { direction: "H" } },
        createEdge(): Edge {
          return canvas.createEdge({
            attrs: {
              line: {
                stroke: "#a3aec5",
                strokeWidth: 2,
                targetMarker: "classic",
              },
            },
          });
        },
      },
      background: { color: "#f8f9fc" },
    });
    graph.current = canvas;
    fitted.current = false;
    viewedExecution.current = undefined;
    rendered.current.clear();
    const update = () => {
      const current = callbacks.current.workflow;
      if (syncing.current || !editable || !current) return;
      callbacks.current.changed?.({
        ...current,
        nodes: current.nodes.map((node) => ({
          ...node,
          position:
            canvas.getCellById(node.id)?.getBBox().getTopLeft().toJSON() ??
            node.position,
        })),
        edges: canvas.getEdges().map((edge) => ({
          source: edge.getSourceCellId(),
          target: edge.getTargetCellId(),
        })),
      });
    };
    canvas.on("node:moved", update);
    canvas.on("edge:connected", update);
    canvas.on("edge:removed", update);
    canvas.on("scale", ({ sx }) => setZoom(Math.round(sx * 100)));
    canvas.on("node:click", ({ node }) => {
      if (!isProvenance && !execution) {
        const previous = selectedId.current
          ? canvas.getCellById(selectedId.current)
          : null;
        if (previous?.isNode()) previous.attr("body/stroke", "#dbe0e9");
        node.attr("body/stroke", "#465fce");
        selectedId.current = node.id;
      }
      callbacks.current.selected?.(node.id);
    });
    canvas.on("blank:click", () => {
      const previous = selectedId.current
        ? canvas.getCellById(selectedId.current)
        : null;
      if (previous?.isNode() && !execution)
        previous.attr("body/stroke", "#dbe0e9");
      selectedId.current = null;
      callbacks.current.dismissed?.();
    });
    canvas.on("edge:dblclick", ({ edge }) => {
      if (editable) edge.remove();
    });
    return () => {
      graph.current = null;
      canvas.dispose();
    };
  }, [editable, isProvenance, !!execution]);

  useEffect(() => {
    const canvas = graph.current;
    if (!canvas) return;
    const nodes = workflow?.nodes ?? provenance?.nodes ?? [],
      edges = workflow?.edges ?? provenance?.edges ?? [];
    const layers = new Map(nodes.map((node) => [node.id, 0]));
    for (let i = 0; i < nodes.length; i++) {
      let moved = false;
      for (const edge of edges) {
        const depth = Math.min(12, (layers.get(edge.source) ?? 0) + 1);
        if (depth > (layers.get(edge.target) ?? 0)) {
          layers.set(edge.target, depth);
          moved = true;
        }
      }
      if (!moved) break;
    }
    const rows = new Map<number, number>();
    syncing.current = true;
    try {
      const model = {
        nodes: nodes.map((node): Node.Metadata => {
          const depth = layers.get(node.id) ?? 0,
            row = rows.get(depth) ?? 0;
          rows.set(depth, row + 1);
          const position =
            "position" in node
              ? node.position
              : { x: 30 + depth * 220, y: 30 + row * 85 };
          const rawLabel =
            "type" in node
              ? node.label || t(`books.node.${node.type}`)
              : node.label ||
                (node.kind === "execution"
                  ? t(
                      `books.node.${node.detail.type}` as Parameters<
                        typeof t
                      >[0],
                    )
                  : t(`books.provenance.${node.kind}`));
          const label = plainLabel(rawLabel);
          if (!("type" in node))
            return {
              id: node.id,
              shape: "rect",
              ...position,
              width: 180,
              height: 56,
              label,
              attrs: {
                body: { rx: 9, ry: 9, stroke: "#dbe0e9", fill: "#fff" },
                label: {
                  fill: "#243449",
                  fontSize: 12,
                  textWrap: { width: 160, height: 45, ellipsis: true },
                },
              },
            };
          const state = execution?.states[node.id];
          const stateColor =
            state === "completed"
              ? "#19926a"
              : state === "failed"
                ? "#d43838"
                : state === "running"
                  ? "#2563eb"
                  : state === "awaiting_input" ||
                      state === "awaiting_publication"
                    ? "#b67c0d"
                    : "#8491a6";
          const style = nodeAppearance[node.type];
          // Keep the full editable workflow visible at entry. At overview scale,
          // show readable titles; zooming in restores the rule and scope details.
          const condensed = editable && zoom < 65;
          const overviewScale = Math.min(4, 100 / zoom);
          const summary =
            execution?.summaries[node.id] ||
            plainLabel(node.parameters.instructions) ||
            t(`books.nodeHint.${node.type}`);
          const scope = execution
            ? t(
                state === "pending"
                  ? "books.pipelinePending"
                  : (`books.status.${state}` as Parameters<typeof t>[0]),
              )
            : node.type === "sources"
              ? node.parameters.sourceIds.length
                ? t("books.graphSourceCount", {
                    count: node.parameters.sourceIds.length,
                  })
                : t("books.graphAllSources")
              : node.type === "acceptance"
                ? node.parameters.criterionIds.length
                  ? t("books.graphCriterionCount", {
                      count: node.parameters.criterionIds.length,
                    })
                  : t("books.graphAllCriteria")
                : t(`books.palette.${style.group}`);
          return {
            id: node.id,
            shape: "rect",
            ...position,
            width: 210,
            height: 120,
            markup: [
              "body",
              "iconBody",
              "icon",
              "title",
              "summary",
              "divider",
              "statusDot",
              "scope",
            ].map((selector) => ({
              tagName:
                selector === "body" || selector === "iconBody"
                  ? "rect"
                  : selector === "divider" || selector === "icon"
                    ? "path"
                    : selector === "statusDot"
                      ? "circle"
                      : "text",
              selector,
            })),
            attrs: {
              body: {
                ...(execution
                  ? {
                      role: "button",
                      tabindex: 0,
                      "aria-label": t("books.pipelineNodeLogs", {
                        node: label,
                        state: scope,
                      }),
                    }
                  : {}),
                rx: 10,
                ry: 10,
                stroke:
                  execution?.selectedId === node.id ||
                  selectedId.current === node.id
                    ? "#465fce"
                    : "#dbe0e9",
                strokeWidth: 1.5,
                fill: "#fff",
              },
              iconBody: {
                x: condensed ? 105 - 12 * overviewScale : 12,
                y: condensed ? 10 : 12,
                width: condensed ? 24 * overviewScale : 30,
                height: condensed ? 24 * overviewScale : 30,
                rx: 8,
                fill: style.fill,
                stroke: "none",
              },
              icon: {
                d: style.path,
                transform: condensed
                  ? `translate(${105 - 8 * overviewScale}, ${10 + 4 * overviewScale}) scale(${(overviewScale * 2) / 3})`
                  : "translate(18, 18) scale(0.75)",
                fill: "none",
                stroke: style.color,
                strokeWidth: 1.8,
                strokeLinecap: "round",
                strokeLinejoin: "round",
              },
              title: {
                refX: 0,
                refY: 0,
                x: condensed ? 105 : 51,
                y: condensed ? 91 : 27,
                text: label,
                textAnchor: condensed ? "middle" : "start",
                textVerticalAnchor: "middle",
                fontSize: condensed ? Math.min(64, 12 / (zoom / 100)) : 14,
                fontWeight: 600,
                fill: "#20304a",
                textWrap: {
                  width: condensed ? 185 : 147,
                  height: condensed ? 44 : 20,
                  ellipsis: true,
                },
              },
              summary: {
                opacity: condensed ? 0 : 1,
                refX: 0,
                refY: 0,
                x: 13,
                y: 55,
                text: summary,
                textAnchor: "start",
                textVerticalAnchor: "top",
                fontSize: 12,
                lineHeight: 17,
                fill: "#647084",
                textWrap: { width: 184, height: 34, ellipsis: true },
              },
              divider: {
                d: "M 13 95 L 197 95",
                stroke: "#edf0f5",
                opacity: condensed ? 0 : 1,
              },
              statusDot: {
                cx: 17,
                cy: 108,
                r: 3,
                fill: stateColor,
                opacity: execution && !condensed ? 1 : 0,
              },
              scope: {
                opacity: condensed ? 0 : 1,
                refX: 0,
                refY: 0,
                x: execution ? 27 : 13,
                y: 108,
                text: scope,
                textAnchor: "start",
                textVerticalAnchor: "middle",
                fontSize: 11,
                fill: execution ? stateColor : style.color,
                textWrap: { width: 184, height: 14, ellipsis: true },
              },
            },
            ports: {
              groups: {
                in: {
                  position: "left",
                  attrs: {
                    circle: {
                      r: 4,
                      magnet: editable ? "passive" : false,
                      stroke: "#a3aec5",
                      strokeWidth: 1.5,
                      fill: "#fff",
                    },
                  },
                },
                out: {
                  position: "right",
                  attrs: {
                    circle: {
                      r: 4,
                      magnet: editable,
                      stroke: "#a3aec5",
                      strokeWidth: 1.5,
                      fill: "#fff",
                    },
                  },
                },
              },
              items: [
                ...(node.type !== "sources" && node.type !== "feedback"
                  ? [{ id: "in", group: "in" }]
                  : []),
                ...(node.type !== "publish"
                  ? [{ id: "out", group: "out" }]
                  : []),
              ],
            },
          };
        }),
        edges: edges.map((edge) => ({
          id: `edge:${encodeURIComponent(edge.source)}:${encodeURIComponent(edge.target)}:${"relation" in edge ? edge.relation : "workflow"}`,
          source: workflow ? { cell: edge.source, port: "out" } : edge.source,
          target: workflow ? { cell: edge.target, port: "in" } : edge.target,
          connector: { name: "rounded" },
          ...(execution
            ? { router: { name: "manhattan", args: { padding: 16 } } }
            : { connector: { name: "smooth", args: { direction: "H" } } }),
          attrs: {
            line: {
              stroke: execution
                ? execution.states[edge.source] === "completed"
                  ? "#73bca3"
                  : "#cbd4e1"
                : "#a3aec5",
              strokeWidth: 1.5,
              targetMarker: { name: "block", width: 6, height: 5 },
            },
          },
          zIndex: 0,
          ...("count" in edge && Number(edge.count) > 1
            ? {
                labels: [
                  {
                    attrs: {
                      label: {
                        text: `×${edge.count}`,
                        fill: "#64748b",
                        fontSize: 11,
                      },
                    },
                  },
                ],
              }
            : {}),
        })),
      };
      // Polling changes node state, not the canvas or its viewport. Keep existing
      // X6 cells and touch only metadata which actually changed.
      const wanted = new Set(
        [...model.nodes, ...model.edges].map((cell) => cell.id),
      );
      canvas.batchUpdate(() => {
        for (const cell of canvas.getCells()) {
          if (!wanted.has(cell.id)) {
            canvas.removeCell(cell);
            rendered.current.delete(cell.id);
          }
        }
        for (const metadata of model.nodes) {
          const signature = JSON.stringify(metadata);
          if (rendered.current.get(metadata.id!) === signature) continue;
          const cell = canvas.getCellById(metadata.id!);
          if (cell?.isNode()) {
            cell.setAttrs(metadata.attrs);
            if (metadata.x !== undefined && metadata.y !== undefined)
              cell.position(metadata.x, metadata.y);
            if (metadata.label !== undefined)
              cell.setProp("label", metadata.label);
            if (
              metadata.ports &&
              JSON.stringify(cell.getProp("ports")) !==
                JSON.stringify(metadata.ports)
            )
              cell.setProp("ports", metadata.ports);
          } else canvas.addNode(metadata);
          rendered.current.set(metadata.id!, signature);
        }
        for (const metadata of model.edges) {
          const signature = JSON.stringify(metadata);
          if (rendered.current.get(metadata.id) === signature) continue;
          const cell = canvas.getCellById(metadata.id);
          if (cell?.isEdge()) {
            cell.setAttrs(metadata.attrs);
            cell.setLabels(metadata.labels ?? []);
          } else canvas.addEdge(metadata);
          rendered.current.set(metadata.id, signature);
        }
      });
    } finally {
      syncing.current = false;
    }
    // Redrawing edited rules or positions must preserve the reader's current view.
    const narrow = (host.current?.clientWidth ?? 0) < 420;
    if (
      !fitted.current ||
      (narrow && execution?.viewId !== viewedExecution.current)
    ) {
      canvas.zoomToFit({
        padding: 32,
        maxScale: 1,
        minScale: narrow ? 1 : execution ? 0.65 : 0.08,
      });
      if (narrow) {
        const failed =
          narrow && execution
            ? workflow?.nodes.find(
                (node) => execution.states[node.id] === "failed",
              )
            : undefined;
        const bounds = failed
          ? canvas.getCellById(failed.id)!.getBBox()
          : canvas.getContentArea();
        const scale = canvas.zoom();
        const left = failed
          ? ((host.current?.clientWidth ?? 0) - bounds.width * scale) / 2
          : 24;
        canvas.translate(left - bounds.x * scale, 24 - bounds.y * scale);
      }
      fitted.current = true;
    }
    viewedExecution.current = execution?.viewId;
  }, [workflow, provenance, editable, t, execution, zoom]);

  function add(type: BookNodeType) {
    const rect = host.current?.getBoundingClientRect(),
      canvas = graph.current;
    if (!rect || !canvas) return;
    const center = canvas.clientToLocal(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    added?.(type, { x: center.x - 105, y: center.y - 60 });
  }
  return (
    <section
      className={`book-graph${expanded ? " book-graph-expanded" : ""}${workflow ? " book-workflow-graph" : ""}${execution ? " book-execution-graph" : ""}`}
    >
      {toolbarVisible && (
        <div className="book-graph-toolbar">
          <div className="book-graph-title">
            <Workflow size={16} />
            <strong>
              {t(
                execution
                  ? "books.pipeline"
                  : workflow
                    ? "books.workflow"
                    : "books.provenance",
              )}
            </strong>
            {workflow && (
              <span>
                {t("books.graphNodeCount", { count: workflow.nodes.length })}
              </span>
            )}
          </div>
          <div className="book-graph-controls">
            {workflow && editable && added && (
              <Tooltip
                title={t(
                  paletteVisible
                    ? "books.hideNodePanel"
                    : "books.showNodePanel",
                )}
              >
                <Button
                  type="text"
                  aria-label={t(
                    paletteVisible
                      ? "books.hideNodePanel"
                      : "books.showNodePanel",
                  )}
                  aria-expanded={paletteVisible}
                  icon={
                    paletteVisible ? (
                      <PanelLeftClose size={16} />
                    ) : (
                      <PanelLeftOpen size={16} />
                    )
                  }
                  onClick={() => setPaletteVisible(!paletteVisible)}
                />
              </Tooltip>
            )}
            <Tooltip title={t("books.fit")}>
              <Button
                type="text"
                aria-label={t("books.fit")}
                icon={<Scan size={16} />}
                onClick={() =>
                  graph.current?.zoomToFit({ padding: 32, maxScale: 1 })
                }
              />
            </Tooltip>
            <Button
              type="text"
              aria-label={t("books.zoomOut")}
              icon={<Minus size={16} />}
              onClick={() => graph.current?.zoom(-0.1)}
            />
            <span className="book-graph-zoom" aria-live="polite">
              {zoom}%
            </span>
            <Button
              type="text"
              aria-label={t("books.zoomIn")}
              icon={<Plus size={16} />}
              onClick={() => graph.current?.zoom(0.1)}
            />
            <Tooltip
              title={t(expanded ? "books.graphCollapse" : "books.graphExpand")}
            >
              <Button
                type="text"
                aria-label={t(
                  expanded ? "books.graphCollapse" : "books.graphExpand",
                )}
                icon={
                  expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />
                }
                onClick={() => setExpanded(!expanded)}
              />
            </Tooltip>
            <Tooltip title={t("books.hideGraphToolbar")}>
              <Button
                type="text"
                aria-label={t("books.hideGraphToolbar")}
                icon={<PanelTopClose size={16} />}
                onClick={() => {
                  setToolbarVisible(false);
                }}
              />
            </Tooltip>
          </div>
        </div>
      )}
      <div className="book-graph-workspace">
        {workflow && editable && added && paletteVisible && toolbarVisible && (
          <div className="book-palette-mobile-hint">
            <MoveHorizontal size={14} aria-hidden="true" />
            {t("books.paletteScrollHint")}
          </div>
        )}
        {workflow && editable && added && paletteVisible && toolbarVisible && (
          <aside className="book-node-palette" aria-label={t("books.addNode")}>
            <div className="book-palette-heading">
              {t("books.addNode")}
              <span>{t("books.paletteHelp")}</span>
            </div>
            {(["inputs", "models", "checks"] as const).map((group) => (
              <div className="book-palette-group" key={group}>
                <h4>{t(`books.palette.${group}`)}</h4>
                {(
                  Object.entries(nodeAppearance) as [
                    BookNodeType,
                    (typeof nodeAppearance)[BookNodeType],
                  ][]
                )
                  .filter(([, style]) => style.group === group)
                  .map(([type, style]) => (
                    <button
                      type="button"
                      className="book-palette-node"
                      key={type}
                      disabled={
                        workflow.nodes.length >= 40 ||
                        (type === "publish" &&
                          workflow.nodes.some(
                            (node) => node.type === "publish",
                          ))
                      }
                      aria-label={t("books.addTypedNode", {
                        type: t(`books.node.${type}`),
                      })}
                      onClick={() => add(type)}
                    >
                      <span
                        className="book-palette-icon"
                        style={{ color: style.color, background: style.fill }}
                      >
                        <style.icon
                          size={18}
                          strokeWidth={1.7}
                          aria-hidden="true"
                        />
                      </span>
                      <span>
                        <strong>{t(`books.node.${type}`)}</strong>
                        <small>{t(`books.nodeHint.${type}`)}</small>
                      </span>
                    </button>
                  ))}
              </div>
            ))}
          </aside>
        )}
        <div className="book-graph-stage">
          {!toolbarVisible && (
            <Tooltip title={t("books.showGraphToolbar")}>
              <Button
                className="book-graph-restore"
                aria-label={t("books.showGraphToolbar")}
                icon={<PanelTopOpen size={16} />}
                onClick={() => {
                  setToolbarVisible(true);
                }}
              />
            </Tooltip>
          )}
          <div
            ref={host}
            onKeyDown={(event) => {
              if (!execution || !["Enter", " "].includes(event.key)) return;
              const id = (event.target as Element)
                .closest("[data-cell-id]")
                ?.getAttribute("data-cell-id");
              if (id && workflow?.nodes.some((node) => node.id === id)) {
                event.preventDefault();
                callbacks.current.selected?.(id);
              }
            }}
            className="book-graph-canvas"
            aria-label={t(
              execution
                ? "books.pipeline"
                : workflow
                  ? "books.workflow"
                  : "books.provenance",
            )}
          />
          <div className="book-graph-hint">
            <MousePointer2 size={13} />
            <span className="book-graph-help-desktop">
              {t(
                workflow
                  ? editable
                    ? "books.graphHelp"
                    : execution
                      ? "books.pipelineGraphHelp"
                      : "books.workflowGraphHelp"
                  : "books.provenanceHelp",
              )}
            </span>
            <span className="book-graph-help-touch">
              {t("books.touchGraphHelp")}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
