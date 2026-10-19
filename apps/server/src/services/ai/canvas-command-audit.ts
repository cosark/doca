/** Request-local facts collected only after the host successfully commits an edit. */
export function canvasRoutingAudit(
  operations: { type: string; [key: string]: any }[],
) {
  return operations.flatMap((op) => {
    const routes =
      op.type === "createFlowchart"
        ? op.edges
        : op.type === "diagramEdge"
          ? [op]
          : [];
    return routes.map((edge: any) => ({
      command: op.type,
      id: edge.id,
      automaticRequested: edge.autoRoute === true,
      requestedMode: edge.mode,
      providedRoutingFields: ["sourcePort", "targetPort", "offset"].filter(
        (key) => edge[key] !== undefined,
      ),
    }));
  });
}
