// Feature-Modul „mcp“: KI-Zugang (persönliche API-Tokens für den MCP-Server unter mcp/). Board-Menü „···“ →
// „KI-Zugang (MCP) …“. Vertrag: docs/features/mcp.md. Im Offline-Modus ohne Server nicht angeboten.
import { createElement } from 'react';
import { defineMenuItem, defineModal } from '../../editor/ext/registry';
import { McpDialog } from './McpAccess';

defineModal({ id: 'mcp.tokens', Component: ({ onClose }) => createElement(McpDialog, { onClose }) });

defineMenuItem({
  id: 'mcp.tokens',
  on: 'board',
  order: 85,
  item: (api) => (api.session.isLocal ? null : { label: 'KI-Zugang (MCP) …', onSelect: () => api.openModal('mcp.tokens') }),
});

export { McpAccessPanel, McpDialog } from './McpAccess';
