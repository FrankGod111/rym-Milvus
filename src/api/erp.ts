export type DocumentRecord = {
  id: string;
  title: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  category?: string;
  tags?: string[];
  status?: string;
  index_status?: string;
  parse_status?: string;
  visibility?: string;
  department_id?: string;
  document_type?: string;
  confidentiality_level?: string;
  knowledge_sync_status?: string;
  dify_document_id?: string;
  ai_enabled?: boolean;
  content_text?: string;
  createdAt?: string;
  updatedAt?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type ApprovalRecord = {
  id: string;
  sessionId?: string;
  sceneType?: string;
  title?: string;
  requesterName?: string;
  approverName?: string;
  status: 'pending' | 'approved' | 'rejected';
  summary?: string;
  decisionNote?: string;
  output?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  submittedAt?: string;
  [key: string]: unknown;
};

export type ChatSource = {
  document_id?: string;
  erp_document_id?: string;
  title?: string;
  document_name?: string;
  download_file_name?: string;
  can_download?: boolean;
  content?: string;
  score?: number;
};

export type ChatResponse = {
  answer: string;
  conversation_id?: string;
  message_id?: string;
  citations?: ChatSource[];
  sources?: ChatSource[];
  metadata?: Record<string, unknown>;
};

export type AssistantSession = {
  id: string;
  sceneType?: string;
  scene_type?: string;
  title: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  summary?: string;
  citations?: ChatSource[];
  conversationId?: string;
  conversation_id?: string;
  status?: string;
  approvalStatus?: string;
  approval_status?: string;
  createdAt?: string;
  updatedAt?: string;
  created_at?: string;
  updated_at?: string;
  messages?: Array<{ id?: string; question?: string; answer?: string; citations?: ChatSource[]; createdAt?: string; created_at?: string }>;
  [key: string]: unknown;
};

export type AssistantTurnResponse = {
  reply: string;
  intent?: string;
  status?: string;
  conversation_id?: string;
  cards?: Array<Record<string, unknown>>;
  citations?: ChatSource[];
  session?: AssistantSession;
  approval?: ApprovalRecord | null;
  suggested_actions?: Array<{ id: string; label: string }>;
  [key: string]: unknown;
};

export type DifyRemoteDocument = {
  id: string;
  name: string;
  indexing_status?: string;
  word_count?: number;
  created_at?: string;
  updated_at?: string;
  enabled?: boolean;
  archived?: boolean;
  data_source_type?: string;
  dataset_id?: string;
  dataset_keys?: string[];
  managed_by_erp?: boolean;
  erp_document_id?: string;
  erp_title?: string;
  permission_note?: string;
  [key: string]: unknown;
};

export type KnowledgeDatasetMapping = {
  id: string;
  scope_type?: string;
  scope_id?: string;
  scope_name?: string;
  archive_category?: string;
  document_type?: string;
  ai_usage_scope?: string;
  dataset_key: string;
  dataset_name?: string;
  dataset_id?: string;
  security_domain?: string;
  allowed_role_ids?: string[];
  allowed_department_ids?: string[];
  enabled?: boolean;
  priority?: number;
  note?: string;
};

export type ArchiveCatalog = { id: string; scope_id?: string; scope_name?: string; name: string; description?: string; status?: string; [key: string]: unknown };
export type ArchiveCatalogItem = { id: string; scope_id?: string; scope_name?: string; category?: string; subcategory?: string; document_name_rule?: string; document_description?: string; required?: boolean; default_ai_enabled?: boolean; [key: string]: unknown };
export type ArchiveTreeNode = {
  id: string;
  parent_id?: string;
  node_type: 'root' | 'organization' | 'category' | string;
  name: string;
  scope_id?: string;
  required?: boolean;
  archive_status?: 'filed' | 'pending' | 'unfiled' | string;
  archive_period?: string;
  retention_period?: string;
  owner_role_id?: string;
  reviewer_role_id?: string;
  ai_enabled?: boolean;
  ai_priority_scope?: boolean;
  ai_summary_template?: string;
  template_name?: string;
  template_content?: string;
  permission_mode?: 'inherit' | 'override' | string;
  allowed_actions?: string[];
  document_count?: number;
  children_count?: number;
  has_children?: boolean;
  breadcrumb?: Array<{ id: string; name: string; node_type?: string }>;
  [key: string]: unknown;
};
export type CoverageRow = { scope_id: string; scope_name: string; required_total: number; filed_total: number; missing_total: number; ai_enabled_total: number; ai_blocked_total: number; coverage_rate: number; items?: ArchiveCatalogItem[]; [key: string]: unknown };
export type ErpDashboard = {
  totals?: { documents?: number; users?: number; roles?: number; departments?: number };
  index_health?: Record<string, number>;
  recent_documents?: DocumentRecord[];
  recent_audit_logs?: Array<Record<string, unknown>>;
  roadmap?: Array<Record<string, unknown>>;
};
export type ErpUser = { id: string; name: string; username: string; role_id?: string; role_name?: string; department_id?: string; department_name?: string; is_admin?: boolean; role?: { id?: string; name?: string; permissions?: string[] } };
export type AccessContext = { user: ErpUser; role: Record<string, unknown>; permissions: string[]; departments: Array<Record<string, unknown>>; org_tree: Array<Record<string, unknown>>; capabilities: Array<Record<string, string>>; menu_permissions: Record<string, boolean> };
export type AccessDecision = { allowed: boolean; subject_type: string; subject_id: string; action: string; source?: string; reason?: string; required_capability?: string; matched_rules?: string[]; denied_by?: string | null; effective_scope?: Record<string, unknown> };

const ERP_PREFIX = '/erp/v1';
const TOKEN_KEY = 'rym-erp-access-token';
let tokenPromise: Promise<{ token: string; user?: ErpUser }> | null = null;

function apiError(payload: unknown, fallback: string): Error {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = (payload as { detail?: unknown }).detail;
    return new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return new Error(fallback);
}

async function login(username: string, password: string): Promise<{ token: string; user?: ErpUser }> {
  const response = await fetch(`${ERP_PREFIX}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.token) throw apiError(payload, 'ERP 登录失败');
  sessionStorage.setItem(TOKEN_KEY, payload.token);
  return { token: payload.token as string, user: payload.user };
}

async function getToken(force = false): Promise<string> {
  if (!force) {
    const cached = sessionStorage.getItem(TOKEN_KEY);
    if (cached) return cached;
  }
  const username = import.meta.env.VITE_ERP_DEMO_USERNAME;
  const password = import.meta.env.VITE_ERP_DEMO_PASSWORD;
  if (!username || !password) throw new Error('ERP_AUTH_REQUIRED');
  if (!tokenPromise) tokenPromise = login(username, password).finally(() => { tokenPromise = null; });
  return tokenPromise.then((result) => result.token);
}

async function request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const token = await getToken();
  const response = await fetch(`${ERP_PREFIX}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
  if (response.status === 401 && retry) {
    sessionStorage.removeItem(TOKEN_KEY);
    await getToken(true);
    return request<T>(path, options, false);
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(payload, response.statusText || '请求失败');
  return payload as T;
}

export const erpApi = {
  hasSession: () => Boolean(sessionStorage.getItem(TOKEN_KEY)),
  login: (username: string, password: string) => login(username, password),
  me: () => request<{ user: ErpUser; token: string; expires_at: string }>('/auth/me'),
  accessContext: () => request<AccessContext>('/access-context'),
  permissionTree: () => request<Array<Record<string, unknown>>>('/permissions/tree'),
  users: () => request<Array<Record<string, unknown>>>('/users'),
  roles: () => request<Array<Record<string, unknown>>>('/roles'),
  updateRolePermissions: (id: string, permissions: string[]) => request<Record<string, unknown>>(`/roles/${encodeURIComponent(id)}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions }) }),
  departments: () => request<Array<Record<string, unknown>>>('/departments'),
  logout: () => sessionStorage.removeItem(TOKEN_KEY),
  listDocuments: (query = '') => request<{ documents: DocumentRecord[]; total: number }>(`/documents${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  getDocument: (id: string) => request<DocumentRecord>(`/documents/${id}`),
  uploadDocument: (file: File, values: Record<string, string | boolean> = {}) => {
    const body = new FormData();
    body.append('file', file);
    Object.entries(values).forEach(([key, value]) => body.append(key, String(value)));
    return request<DocumentRecord>('/documents/upload', { method: 'POST', body });
  },
  updateDocument: (id: string, values: Partial<DocumentRecord>) => request<DocumentRecord>(`/documents/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  updateDocumentPermissions: (id: string, values: Record<string, unknown>) => request<Record<string, unknown>>(`/documents/${encodeURIComponent(id)}/permissions`, { method: 'PUT', body: JSON.stringify(values) }),
  documentAccessDecision: (id: string, action = 'read') => request<AccessDecision>(`/documents/${encodeURIComponent(id)}/access-decision?action=${encodeURIComponent(action)}`),
  updateCatalogPermissions: (id: string, values: Record<string, unknown>) => request<Record<string, unknown>>(`/archive/catalogs/${encodeURIComponent(id)}/permissions`, { method: 'PUT', body: JSON.stringify(values) }),
  deleteDocument: (id: string) => request<void>(`/documents/${id}`, { method: 'DELETE' }),
  syncDocument: (id: string) => request<Record<string, unknown>>(`/documents/${id}/sync-to-dify`, { method: 'POST' }),
  refreshDocumentSync: (id: string) => request<Record<string, unknown>>(`/documents/${id}/refresh-dify-status`, { method: 'POST' }),
  chat: (question: string, conversationId = '') => request<ChatResponse>('/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ question, conversation_id: conversationId }),
  }),
  assistantTurn: (message: string, conversationId = '', context: Record<string, unknown> = {}, attachments: Record<string, unknown> = {}) => request<AssistantTurnResponse>('/assistant/turn', {
    method: 'POST',
    body: JSON.stringify({ message, conversation_id: conversationId, context, attachments }),
  }),
  dashboard: () => request<ErpDashboard>('/dashboard'),
  assistantSessions: () => request<AssistantSession[]>('/assistant/sessions'),
  assistantSessionDetail: (sessionId: string) => request<AssistantSession>(`/assistant/sessions/${encodeURIComponent(sessionId)}`),
  deleteAssistantSession: (sessionId: string) => request<void>(`/assistant/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
  assistantApprovals: () => request<ApprovalRecord[]>('/assistant/approvals'),
  assistantUpdateApproval: (approvalId: string, status: 'approved' | 'rejected', note = '') => request<ApprovalRecord>(`/assistant/approvals/${encodeURIComponent(approvalId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, note }),
  }),
  difyConfig: () => request<Record<string, unknown>>('/dify/config'),
  knowledgeDatasetMappings: () => request<{ mappings: KnowledgeDatasetMapping[] }>('/knowledge/datasets/mapping'),
  updateKnowledgeDatasetMappings: (mappings: KnowledgeDatasetMapping[]) => request<{ mappings: KnowledgeDatasetMapping[] }>('/knowledge/datasets/mapping', { method: 'PATCH', body: JSON.stringify({ mappings }) }),
  exportKnowledgeMigrationInventory: async () => {
    const token = await getToken();
    const response = await fetch(`${ERP_PREFIX}/knowledge/migration-inventory/export`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw apiError(await response.json().catch(() => ({})), '迁移清单导出失败');
    return response.blob();
  },
  difyDocuments: () => request<{ documents: DifyRemoteDocument[]; total: number; dataset_id?: string }>('/dify/documents'),
  linkDifyDocument: (difyDocumentId: string, values: { name: string; scope_id: string; scope_name?: string; catalog_item_id?: string; archive_tree_node_id?: string; visibility?: string; confidentiality_level?: string; ai_usage_scope?: string; dataset_id?: string }) => request<DocumentRecord>(`/dify/documents/${encodeURIComponent(difyDocumentId)}/link`, { method: 'POST', body: JSON.stringify(values) }),
  listApprovals: () => request<ApprovalRecord[]>('/approvals'),
  getApproval: (id: string) => request<ApprovalRecord>(`/approvals/${id}`),
  decideApproval: (id: string, status: 'approved' | 'rejected', note: string) => request<ApprovalRecord>(`/approvals/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, note }),
  }),
  archiveDocuments: (query = '') => request<{ documents: DocumentRecord[]; total: number; filters: Record<string, unknown> }>(`/archive/documents${query ? `?${query}` : ''}`),
  archiveDocument: (id: string) => request<DocumentRecord>(`/archive/documents/${id}`),
  uploadArchiveDocument: (file: File, values: Record<string, string | boolean> = {}) => {
    const body = new FormData();
    body.append('file', file);
    Object.entries(values).forEach(([key, value]) => body.append(key, String(value)));
    return request<DocumentRecord>('/archive/documents/upload', { method: 'POST', body });
  },
  archiveScopes: () => request<Array<{ id: string; name: string; children?: unknown[] }>>('/archive/scopes'),
  archiveCatalogs: (scopeId = '') => request<ArchiveCatalog[]>(`/archive/catalogs${scopeId ? `?scope_id=${encodeURIComponent(scopeId)}` : ''}`),
  archiveCatalogItems: (scopeId = '') => request<ArchiveCatalogItem[]>(`/archive/catalog-items${scopeId ? `?scope_id=${encodeURIComponent(scopeId)}` : ''}`),
  archiveCatalogItemDocuments: (itemId: string) => request<{ documents: DocumentRecord[]; total: number }>(`/archive/catalog-items/${encodeURIComponent(itemId)}/documents`),
  matchArchiveDocumentToCatalog: (documentId: string, itemId: string) => request<DocumentRecord>(`/archive/documents/${encodeURIComponent(documentId)}/match-catalog`, {
    method: 'POST',
    body: JSON.stringify({ item_id: itemId }),
  }),
  transferArchiveDocumentScope: (documentId: string, targetScopeId: string, targetCatalogItemId = '', visibility = 'department', roleIds: string[] = [], userIds: string[] = []) => request<DocumentRecord>(`/archive/documents/${encodeURIComponent(documentId)}/transfer-scope`, {
    method: 'POST',
    body: JSON.stringify({ target_scope_id: targetScopeId, target_catalog_item_id: targetCatalogItemId, visibility, role_ids: roleIds, user_ids: userIds }),
  }),
  createArchiveCatalog: (values: Record<string, unknown>) => request<ArchiveCatalog>('/archive/catalogs', { method: 'POST', body: JSON.stringify(values) }),
  updateArchiveCatalog: (id: string, values: Record<string, unknown>) => request<ArchiveCatalog>(`/archive/catalogs/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  deleteArchiveCatalog: (id: string) => request<ArchiveCatalog>(`/archive/catalogs/${id}`, { method: 'DELETE' }),
  createArchiveCatalogItem: (values: Record<string, unknown>) => request<ArchiveCatalogItem>('/archive/catalog-items', { method: 'POST', body: JSON.stringify(values) }),
  updateArchiveCatalogItem: (id: string, values: Record<string, unknown>) => request<ArchiveCatalogItem>(`/archive/catalog-items/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  archiveCoverage: () => request<CoverageRow[]>('/archive/coverage'),
  archiveCoverageDetail: (scopeId: string) => request<CoverageRow>(`/archive/coverage/${scopeId}`),
  archiveMissing: (query = '') => request<{ items: ArchiveCatalogItem[]; total: number }>(`/archive/missing-required${query ? `?${query}` : ''}`),
  archiveTreeChildren: (parentId = '') => request<ArchiveTreeNode[]>(`/archive/tree/children${parentId ? `?parent_id=${encodeURIComponent(parentId)}` : ''}`),
  archiveTreeNodes: () => request<ArchiveTreeNode[]>('/archive/tree/nodes'),
  archiveTreeNode: (id: string) => request<ArchiveTreeNode>(`/archive/tree/nodes/${encodeURIComponent(id)}`),
  archiveTreeAccessDecision: (id: string, action = 'read') => request<AccessDecision>(`/archive/tree/nodes/${encodeURIComponent(id)}/access-decision?action=${encodeURIComponent(action)}`),
  archiveTreeNodeUploadDefaults: (id: string) => request<Record<string, unknown>>(`/archive/tree/nodes/${encodeURIComponent(id)}/upload-defaults`),
  createArchiveTreeNode: (values: Record<string, unknown>) => request<ArchiveTreeNode>('/archive/tree/nodes', { method: 'POST', body: JSON.stringify(values) }),
  updateArchiveTreeNode: (id: string, values: Record<string, unknown>) => request<ArchiveTreeNode>(`/archive/tree/nodes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(values) }),
  batchUpdateArchiveTreeNodes: (values: Record<string, unknown>) => request<{ nodes: ArchiveTreeNode[]; affected: number }>('/archive/tree/batch-update', { method: 'POST', body: JSON.stringify(values) }),
  moveArchiveTreeNode: (id: string, targetParentId: string, sortOrder = 0) => request<ArchiveTreeNode>(`/archive/tree/nodes/${encodeURIComponent(id)}/move`, { method: 'POST', body: JSON.stringify({ target_parent_id: targetParentId, sort_order: sortOrder }) }),
  mergeArchiveTreeNode: (id: string, targetNodeId: string) => request<ArchiveTreeNode>(`/archive/tree/nodes/${encodeURIComponent(id)}/merge`, { method: 'POST', body: JSON.stringify({ target_node_id: targetNodeId }) }),
  archiveTreeNodeDocuments: (id: string) => request<{ documents: DocumentRecord[]; total: number }>(`/archive/tree/nodes/${encodeURIComponent(id)}/documents`),
  archiveTreeNodeTemplate: (id: string) => request<{ node_id: string; name: string; content: string; source_node_id?: string }>(`/archive/tree/nodes/${encodeURIComponent(id)}/template`),
  downloadArchiveTreeTemplate: async (id: string) => {
    const token = await getToken();
    const response = await fetch(`${ERP_PREFIX}/archive/tree/nodes/${encodeURIComponent(id)}/template/download`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw apiError(await response.json().catch(() => ({})), '模板下载失败');
    return response.blob();
  },
  archiveTreeNodeAuditLogs: (id: string) => request<Array<Record<string, unknown>>>(`/archive/tree/nodes/${encodeURIComponent(id)}/audit-logs`),
  exportArchiveMissing: async (query = '') => {
    const token = await getToken();
    const response = await fetch(`${ERP_PREFIX}/archive/missing-items/export${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(await response.text());
    return response.text();
  },
  indexStatus: () => request<Record<string, unknown>>('/index/status'),
  reindexDocuments: (ids: string[]) => request<Record<string, unknown>>('/documents/batch/reindex', { method: 'POST', body: JSON.stringify({ ids }) }),
  reparseDocument: (id: string) => request<DocumentRecord>(`/documents/${encodeURIComponent(id)}/reparse`, { method: 'POST' }),
  downloadDocument: async (id: string) => {
    const token = await getToken();
    const response = await fetch(`${ERP_PREFIX}/documents/${encodeURIComponent(id)}/download`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw apiError(await response.json().catch(() => ({})), '文档下载失败');
    return response.blob();
  },
};
