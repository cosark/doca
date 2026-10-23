import { useMemo, type ComponentProps } from "react";
import { FileSourceDialog, FolderFilePicker } from "@web/features/files/files.js";
import { SearchPanel } from "@web/features/search/search.js";
import { webPluginRegistry } from "@web/plugins/registry.js";
import { AIUserSettings } from "./ai-user-settings.js";
import { AIReferencePreview } from "./ai-reference-preview.js";
import { AIChat as SharedAIChat } from "./ai-chat.js";
import { AIChatRuntimeProvider, useAIChatRuntime, type AIChatRuntime } from "./ai-runtime.js";

/** Website-only composition; the browser extension bundles the same chat view
 * without file explorers, editor previews or installed workspace extensions.
 */
export function AIChat(props: ComponentProps<typeof SharedAIChat>) {
  const runtime = useAIChatRuntime();
  const hostRuntime = useMemo<AIChatRuntime>(() => ({
    ...runtime,
    workspace: { FileSourceDialog, FolderFilePicker, SearchPanel, AIUserSettings, ReferencePreview: AIReferencePreview },
    renderBlock: (kind, payload, context) =>
      webPluginRegistry.aiBlocks.getByConflictKey(kind)?.render(payload, context),
  }), [runtime]);
  return <AIChatRuntimeProvider runtime={hostRuntime}><SharedAIChat {...props} /></AIChatRuntimeProvider>;
}
