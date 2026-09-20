async function parseResponse(res) {
  if (res.status === 204) return null;

  const contentType = res.headers.get('content-type') || '';
  const rawText = await res.text();

  if (!rawText) return null;

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawText);
    } catch {
      return { detail: rawText };
    }
  }

  return rawText;
}

const api = async (path, options = {}) => {
  const isForm = options.body instanceof FormData;
  const headers = isForm
    ? { ...(options.headers || {}) }
    : { 'Content-Type': 'application/json; charset=utf-8', ...(options.headers || {}) };

  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(`/erp/v1${path}`, {
    ...options,
    headers
  });

  const data = await parseResponse(res);

  if (!res.ok) {
    if (res.status === 401) clearSession();
    if (typeof data === 'string') throw new Error(data || res.statusText);
    throw new Error(data?.detail || res.statusText);
  }

  return data;
};

const state = {
  user: JSON.parse(localStorage.getItem('erpUser') || 'null'),
  token: localStorage.getItem('erpToken') || '',
  view: 'assistant',
  ref: { users: [], roles: [], departments: [], settings: {}, capabilities: [] },
  documents: [],
  selected: new Set(),
  filters: {},
  selectedSceneId: '',
  selectedApprovalId: '',
  sessionFilter: 'all',
  approvalFilter: 'all',
  archiveCoverageRows: [],
  selectedCoverageScopeId: '',
  selectedCoverageDetail: null,
  missingItemsFilters: { filing_year: '', filing_period: '' },
  selectedMissingScopeId: '',
  uploadPrefill: null,
  permissionSearch: { users: '', roles: '', departments: '' },
  permissionDraft: null,
  aiReviewStatusFilter: '',
  catalogDraft: null,
  assistant: {
    conversationId: '',
    messages: [
      {
        role: 'assistant',
        text: '你好，我是这个沙盒里的企业智能助手。你可以直接问制度流程、让我生成会议纪要/合同审查/测试报告草稿，或者让我帮你提交审批。',
        cards: [],
        citations: []
      }
    ],
    draftIntent: '',
    pendingFields: [],
    pendingFormValues: {},
    currentSession: null,
    currentApproval: null,
    currentCitations: [],
    working: false,
    error: ''
  },
  employeeQa: {
    question: '',
    answer: '',
    citations: [],
    conversationId: '',
    confidence: 0,
    retrievedCount: 0,
    error: ''
  },
  selectedCatalogScopeId: '',
  selectedPermissionDocumentId: ''
};

const viewGroups = [
  {
    label: '智能助手',
    items: [
      { id: 'assistant', label: '单助手工作台', kicker: 'Assistant' },
      { id: 'workbench', label: '场景总览', kicker: 'Workbench' },
      { id: 'sessions', label: '历史会话页', kicker: 'Scene Sessions' },
      { id: 'approvals', label: '审批确认页', kicker: 'Approvals' }
    ]
  },
  {
    label: '高级入口',
    items: [
      { id: 'employee-qa', label: '员工问答入口', kicker: 'Employee QA' },
      { id: 'contract-review', label: '合同对比上传页', kicker: 'Contract Review' },
      { id: 'meeting-summary', label: '纪要生成页', kicker: 'Meeting Summary' },
      { id: 'test-report', label: '测试报告生成页', kicker: 'Test Report' }
    ]
  },
  {
    label: '知识管理',
    items: [
      { id: 'documents', label: '文档库', kicker: 'Documents' },
      { id: 'archive-library', label: '档案库', kicker: 'Archive Library' },
      { id: 'archive-catalogs', label: '档案目录', kicker: 'Archive Catalogs' },
      { id: 'upload', label: '文档上传', kicker: 'Upload' },
      { id: 'archive-coverage', label: '覆盖看板', kicker: 'Archive Coverage' },
      { id: 'missing-items', label: '缺失提醒', kicker: 'Missing Items' },
      { id: 'ai-governance', label: 'AI 治理', kicker: 'AI Governance' },
      { id: 'index', label: '知识库索引状态', kicker: 'Index Status' },
      { id: 'ai', label: 'AI 调试台', kicker: 'AI Debug' },
      { id: 'roadmap', label: '预留功能', kicker: 'Roadmap' }
    ]
  },
  {
    label: '系统管理',
    items: [
      { id: 'dashboard', label: '管理仪表盘', kicker: 'Dashboard' },
      { id: 'permissions', label: '权限配置', kicker: 'Permissions', adminOnly: true },
      { id: 'users', label: '用户管理', kicker: 'Users', adminOnly: true },
      { id: 'roles', label: '角色管理', kicker: 'Roles', adminOnly: true },
      { id: 'departments', label: '部门管理', kicker: 'Departments', adminOnly: true },
      { id: 'audit', label: '审计日志', kicker: 'Audit', adminOnly: true },
      { id: 'settings', label: '系统设置', kicker: 'Settings', adminOnly: true }
    ]
  }
];

const viewMeta = new Map(viewGroups.flatMap((group) => group.items).map((item) => [item.id, item]));

const $ = (id) => document.getElementById(id);
const esc = (value = '') => String(value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const fmt = (iso = '') => iso ? new Date(iso).toLocaleString('zh-CN') : '-';
const isAdmin = () => state.user?.role_id === 'role-admin';
const nowIso = () => new Date().toISOString();
const shortText = (value = '', max = 160) => {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
const createId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

function sceneLabel(sceneType) {
  return {
    'employee-qa': '普通员工问答',
    'contract-review': '合同对比审查',
    'meeting-summary': '会议纪要生成',
    'test-report': '测试报告生成'
  }[sceneType] || sceneType;
}

function approvalStatusLabel(status) {
  return {
    pending: '待审批',
    approved: '已通过',
    rejected: '已退回',
    not_submitted: '未提交'
  }[status] || status;
}

function boolLabel(value) {
  return value ? '是' : '否';
}

function archiveStatusLabel(status) {
  return {
    unfiled: '未归档',
    filed: '已归档',
    pending: '待补充',
    void: '已作废'
  }[status] || status || '-';
}

function aiScopeLabel(scope) {
  return {
    archive_only: '仅档案库',
    ai_search: 'AI 检索',
    ai_answer: 'AI 问答'
  }[scope] || scope || '-';
}

function syncStatusLabel(status) {
  return {
    disabled: '禁用',
    pending: '待同步',
    synced: '已同步',
    failed: '失败',
    stale: '待刷新',
    not_synced: '未同步'
  }[status] || status || '-';
}

async function getSceneSessions() {
  return api('/scene-sessions');
}

async function getApprovals() {
  return api('/approvals');
}

async function assistantTurn({ message = '', attachments = {}, context = {} }) {
  return api('/assistant/turn', {
    method: 'POST',
    body: JSON.stringify({
      message,
      conversation_id: state.assistant.conversationId,
      active_session_id: state.assistant.currentSession?.id || '',
      attachments,
      context
    })
  });
}

async function getAssistantSessions() {
  return api('/assistant/sessions');
}

async function getAssistantApprovals() {
  return api('/assistant/approvals');
}

async function submitAssistantApproval(sessionId, note = '') {
  return api(`/assistant/sessions/${sessionId}/submit-approval`, {
    method: 'POST',
    body: JSON.stringify({ note })
  });
}

async function updateAssistantApproval(approvalId, status, note = '') {
  return api(`/assistant/approvals/${approvalId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, note })
  });
}

async function createSceneSession({ sceneType, title, input, output, summary, citations = [], conversationId = '', status = 'completed' }) {
  const record = await api('/scene-sessions', {
    method: 'POST',
    body: JSON.stringify({
      scene_type: sceneType,
      title,
      input,
      output,
      summary,
      citations,
      conversation_id: conversationId,
      status
    })
  });
  state.selectedSceneId = record.id;
  return record;
}

async function createApprovalForSession(sessionId) {
  const note = window.prompt('补充审批说明（可选）', '') ?? '';
  const approval = await api('/approvals', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, note })
  });
  state.selectedApprovalId = approval.id;
  toast('已提交到审批确认页');
  return approval;
}

async function updateApprovalStatus(approvalId, status) {
  const current = await api(`/approvals/${approvalId}`);
  const defaultNote = current.decisionNote || '';
  const note = window.prompt(`填写${approvalStatusLabel(status)}意见（可选）`, defaultNote) ?? defaultNote;
  const approval = await api(`/approvals/${approvalId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, note })
  });
  state.selectedApprovalId = approval.id;
  toast(`审批状态已更新为：${approvalStatusLabel(status)}`);
}

function clearSession() {
  localStorage.removeItem('erpUser');
  localStorage.removeItem('erpToken');
  state.user = null;
  state.token = '';
  showLogin();
}

function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('show');
  setTimeout(() => node.classList.remove('show'), 2200);
}

function showApp() {
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('userBadge').textContent = `${state.user?.name || '用户'} · ${state.user?.role_name || ''}`;
}

function showLogin() {
  $('app').classList.add('hidden');
  $('login').classList.remove('hidden');
}

async function init() {
  bindShell();
  renderNav();
  if (state.user) {
    try {
      const session = await api('/auth/me');
      state.user = session.user;
      state.token = session.token;
      localStorage.setItem('erpUser', JSON.stringify(state.user));
      localStorage.setItem('erpToken', state.token);
      showApp();
      renderNav();
      await loadReference();
      await switchView('assistant');
    } catch {
      clearSession();
    }
  } else {
    showLogin();
  }
}

function bindShell() {
  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('loginError').textContent = '';
    try {
      const result = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: $('username').value, password: $('password').value })
      });
      state.user = result.user;
      state.token = result.token;
      localStorage.setItem('erpUser', JSON.stringify(state.user));
      localStorage.setItem('erpToken', state.token);
      showApp();
      renderNav();
      await loadReference();
      await switchView('assistant');
    } catch (err) {
      $('loginError').textContent = err.message;
    }
  });

  $('logoutBtn').addEventListener('click', () => {
    clearSession();
  });

  document.body.addEventListener('click', async (event) => {
    const viewBtn = event.target.closest('.switch-view');
    if (viewBtn) await switchView(viewBtn.dataset.view);
  });
}

function renderNav() {
  const visibleGroups = viewGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.adminOnly || isAdmin())
    }))
    .filter((group) => group.items.length);

  $('nav').innerHTML = visibleGroups.map((group) => `
    <section class="nav-group">
      <p class="nav-group-title">${group.label}</p>
      ${group.items.map((item) => `<button class="nav-btn" data-view="${item.id}">${item.label}</button>`).join('')}
    </section>
  `).join('');

  $('nav').onclick = (event) => {
    const btn = event.target.closest('button[data-view]');
    if (btn) switchView(btn.dataset.view);
  };
}

async function loadReference() {
  state.ref = await api('/reference');
}

async function switchView(view) {
  state.view = view;
  const meta = viewMeta.get(view) || viewMeta.get('workbench');
  $('sectionTitle').textContent = meta.label;
  $('sectionKicker').textContent = meta.kicker;
  document.querySelectorAll('.nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === meta.id));

  const renderers = {
    assistant,
    workbench,
    'employee-qa': employeeQa,
    'contract-review': contractReview,
    'meeting-summary': meetingSummary,
    'test-report': testReport,
    sessions,
    approvals,
    dashboard,
    documents,
    'archive-library': archiveLibrary,
    'archive-catalogs': archiveCatalogs,
    upload,
    'archive-coverage': archiveCoverage,
    'missing-items': missingItems,
    'ai-governance': aiGovernance,
    index: indexStatus,
    permissions,
    ai,
    users,
    roles,
    departments,
    audit,
    settings,
    roadmap
  };

  try {
    await (renderers[meta.id] || workbench)();
  } catch (err) {
    $('content').innerHTML = `<section class="panel"><p class="error">${esc(err.message)}</p></section>`;
  }
}

function metric(label, value, sub = '') {
  return `<div class="metric"><span>${label}</span><b>${value}</b><small class="subtle">${sub}</small></div>`;
}

function list(items, render) {
  if (!items.length) return '<p class="subtle">暂无数据。</p>';
  return `<div class="list">${items.map((item) => `<div class="list-item"><div>${render(item)}</div></div>`).join('')}</div>`;
}

function optionList(items, selected = '', includeAll = true) {
  const base = includeAll ? '<option value="">全部</option>' : '';
  return `${base}${items.map((item) => `<option value="${esc(item.id || item)}" ${selected === (item.id || item) ? 'selected' : ''}>${esc(item.name || item)}</option>`).join('')}`;
}

function suggestionChips(questions) {
  return `<div class="chip-row">${questions.map((question) => `<button class="chip" data-question="${esc(question)}">${esc(question)}</button>`).join('')}</div>`;
}

function renderCitations(citations = []) {
  if (!citations.length) return '<p class="subtle">暂无引用信息。</p>';
  return `<div class="list">${citations.map((item, index) => `
    <div class="list-item">
      <div>
        <strong>引用 #${index + 1} ${esc(item.document_name || item.document_id || '参考资料')}</strong>
        <small>${esc(item.source_type === 'archive_record' ? '档案记录' : item.source_type === 'ai_knowledge_source' ? 'AI 知识来源' : '引用来源')} · score: ${esc(String(item.score ?? '-'))} · segment: ${esc(item.segment_id || '-')}</small>
        <p>${esc(item.content || '').slice(0, 600)}</p>
      </div>
    </div>`).join('')}</div>`;
}

function aiGateLabel(doc) {
  return doc.ai_gate_allowed ? '允许进入 AI' : '禁止进入 AI';
}

function aiGateStatusClass(doc) {
  return doc.ai_gate_allowed ? 'completed' : 'failed';
}

function reviewStatusLabel(status) {
  return {
    approved: '已通过',
    rejected: '已退回',
    pending: '待审核'
  }[status] || status || '待审核';
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function userNameById(userId) {
  return (state.ref.users || []).find((item) => item.id === userId)?.name || userId || '-';
}

function csvValue(items = []) {
  return (items || []).join(', ');
}

function parseCsvInput(value = '') {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function departmentNameById(departmentId) {
  return (state.ref.departments || []).find((item) => item.id === departmentId)?.name || departmentId || '-';
}

function roleNameById(roleId) {
  return (state.ref.roles || []).find((item) => item.id === roleId)?.name || roleId || '-';
}

function collectOrgNodeIds(nodes = []) {
  return nodes.flatMap((node) => [node.id, ...collectOrgNodeIds(node.children || [])]);
}

function findOrgPath(nodes = [], id = '') {
  for (const node of nodes) {
    if (node.id === id) return node.path || '';
    const child = findOrgPath(node.children || [], id);
    if (child) return child;
  }
  return '';
}

function renderCatalogTree(nodes = [], depth = 0) {
  return nodes.map((node) => {
    const selected = state.selectedCatalogScopeId === node.id;
    return `
      <div class="tree-row">
        <button class="tree-node ${selected ? 'active' : ''}" data-scope-id="${esc(node.id)}" style="--tree-depth:${depth};">${esc(node.name)}</button>
        ${(node.children || []).length ? `<div class="tree-children">${renderCatalogTree(node.children, depth + 1)}</div>` : ''}
      </div>`;
  }).join('');
}

function renderStructuredValue(value) {
  if (Array.isArray(value)) {
    if (!value.length) return '<p class="subtle">暂无内容。</p>';
    return `<ul class="result-list">${value.map((item) => `<li>${esc(typeof item === 'string' ? item : JSON.stringify(item, null, 2))}</li>`).join('')}</ul>`;
  }

  if (value && typeof value === 'object') {
    return `<pre class="preview compact-preview">${esc(JSON.stringify(value, null, 2))}</pre>`;
  }

  return `<p>${esc(value || '暂无内容。')}</p>`;
}

function renderOutputSections(output = {}) {
  return Object.entries(output).map(([key, value]) => `
    <section class="panel compact-panel">
      <div class="section-title">
        <h2>${esc({
          answer: '问答结果',
          summary: '摘要',
          decisions: '决议',
          todos: '待办',
          risks: '风险提示',
          differences: '差异摘要',
          suggestions: '建议动作',
          releaseRecommendation: '上线建议',
          findings: '主要发现',
          scope: '测试范围'
        }[key] || key)}</h2>
      </div>
      ${renderStructuredValue(value)}
    </section>
  `).join('');
}

function renderAssistantCards(cards = []) {
  if (!cards.length) return '';
  return `<div class="assistant-card-stack">${cards.map((card) => {
    if (card.type === 'citations') {
      return `<section class="panel compact-panel"><div class="section-title"><h2>${esc(card.title)}</h2></div>${renderCitations(card.data?.citations || [])}</section>`;
    }
    if (card.type === 'archive_overview') {
      const overview = card.data?.overview || [];
      const missing = card.data?.missing || [];
      return `<section class="panel compact-panel"><div class="section-title"><h2>${esc(card.title)}</h2></div><p>${esc(card.body || '')}</p><div class="table-wrap"><table><thead><tr><th>部门</th><th>覆盖率</th><th>缺失</th><th>AI 可用</th></tr></thead><tbody>${overview.map((item) => `<tr><td>${esc(item.scope_name || '-')}</td><td>${esc(String(item.coverage_rate ?? 0))}%</td><td>${esc(String(item.missing_total ?? 0))}</td><td>${esc(String(item.ai_enabled_total ?? 0))}</td></tr>`).join('') || '<tr><td colspan="4" class="subtle">暂无数据。</td></tr>'}</tbody></table></div>${missing.length ? `<div class="section-title"><h2>缺失样例</h2></div>${list(missing, (item) => `<strong>${esc(item.scope_name || '-')} · ${esc(item.document_name_rule || '-')}</strong><small>${esc(item.category || '-')} / ${esc(item.subcategory || '-')}</small>`)}` : ''}<div class="actions-row">${(card.actions || []).map((action) => `<button class="small-btn" data-assistant-action="${esc(action.id)}">${esc(action.label)}</button>`).join('')}</div></section>`;
    }
    if (card.type === 'archive_missing_summary') {
      const rows = card.data?.rows || [];
      return `<section class="panel compact-panel"><div class="section-title"><h2>${esc(card.title)}</h2></div><p>${esc(card.body || '')}</p>${list(rows, (item) => `<strong>${esc(item.scope_name || '-')}</strong><small>缺失 ${esc(String(item.missing_total ?? 0))} 项 · 覆盖率 ${esc(String(item.coverage_rate ?? 0))}%</small>`)}</section>`;
    }
    if (card.type === 'ai_governance') {
      const candidates = card.data?.candidates || [];
      const documents = card.data?.documents || [];
      return `<section class="panel compact-panel"><div class="section-title"><h2>${esc(card.title)}</h2></div><p>${esc(card.body || '')}</p><div class="section-title"><h2>允许进入 AI</h2></div>${list(candidates, (item) => `<strong>${esc(item.title || '-')}</strong><small>${esc(item.department_name || '-')} · ${esc(aiScopeLabel(item.ai_usage_scope))}</small><p>${esc(item.dataset_mapping?.dataset_name || item.knowledge_dataset_key || '未配置 dataset')}</p>`) }<div class="section-title"><h2>当前阻断重点</h2></div>${list(documents.filter((item) => !item.ai_gate_allowed).slice(0, 6), (item) => `<strong>${esc(item.title || '-')}</strong><small>${esc(item.department_name || '-')} · ${esc(reviewStatusLabel(item.ai_review_status || 'pending'))}</small><p>${esc(item.ai_gate_block_reason || item.review_pending_reason || '-')}</p>`) }<div class="actions-row">${(card.actions || []).map((action) => `<button class="small-btn" data-assistant-action="${esc(action.id)}">${esc(action.label)}</button>`).join('')}</div></section>`;
    }
    if (card.type === 'draft') {
      return `<section class="panel compact-panel"><div class="section-title"><h2>${esc(card.title)}</h2></div><p>${esc(card.body || '')}</p>${renderOutputSections(card.data?.output || {})}<div class="actions-row">${(card.actions || []).map((action) => `<button class="small-btn" data-assistant-action="${esc(action.id)}">${esc(action.label)}</button>`).join('')}</div></section>`;
    }
    if (card.type === 'approval') {
      const approval = card.data || {};
      const canApprove = isAdmin() && approval.id && approval.status === 'pending';
      return `<section class="panel compact-panel"><div class="section-title"><h2>${esc(card.title)}</h2><span class="status ${esc(approval.status || 'pending')}">${esc(approvalStatusLabel(approval.status || 'pending'))}</span></div><p>${esc(card.body || '')}</p><div class="list-item"><div><strong>${esc(approval.title || '审批事项')}</strong><small>${esc(approval.requesterName || '')} · ${fmt(approval.updatedAt || approval.updated_at)}</small><p>${esc(approval.summary || '')}</p></div></div><div class="actions-row">${canApprove ? `<button class="small-btn" data-approval-id="${esc(approval.id)}" data-assistant-approval-status="approved">通过</button><button class="small-btn warn" data-approval-id="${esc(approval.id)}" data-assistant-approval-status="rejected">退回</button>` : ''}</div></section>`;
    }
    if (card.type === 'sessions') {
      const sessions = card.data?.sessions || [];
      return `<section class="panel compact-panel"><div class="section-title"><h2>${esc(card.title)}</h2></div>${list(sessions, (session) => `<strong>${esc(session.title)}</strong><small>${esc(sceneLabel(session.sceneType || session.scene_type || ''))} · ${fmt(session.updatedAt || session.updated_at)}</small><div class="actions-row"><button class="small-btn" data-assistant-action="load-session" data-session-id="${esc(session.id)}">加载到当前助手</button></div>`)}</section>`;
    }
    if (card.type === 'approvals') {
      const approvals = card.data?.approvals || [];
      return `<section class="panel compact-panel"><div class="section-title"><h2>${esc(card.title)}</h2></div>${list(approvals, (approval) => `<strong>${esc(approval.title)}</strong><small>${esc(approvalStatusLabel(approval.status))} · ${fmt(approval.updatedAt || approval.updated_at)}</small><div class="actions-row"><button class="small-btn" data-assistant-action="load-approval" data-approval-id="${esc(approval.id)}">打开审批卡片</button></div>`)}</section>`;
    }
    if (card.type === 'form') {
      const fields = card.data?.fields || [];
      const formId = createId('assistant-form');
      return `<section class="panel compact-panel"><div class="section-title"><h2>${esc(card.title)}</h2></div><p>${esc(card.body || '')}</p><form data-assistant-form="${esc(formId)}" data-intent="${esc(card.data?.intent || '')}" class="form-grid">${fields.map((field) => {
        const value = state.assistant.pendingFormValues?.[field.key] || '';
        return `<label class="${field.input_type === 'textarea' ? 'wide' : ''}">${esc(field.label)}${field.input_type === 'textarea' ? `<textarea name="${esc(field.key)}" placeholder="${esc(field.placeholder || '')}">${esc(value)}</textarea>` : `<input name="${esc(field.key)}" value="${esc(value)}" placeholder="${esc(field.placeholder || '')}">`}</label>`;
      }).join('')}<div class="wide actions-row"><button class="accent" type="submit" data-assistant-submit="${esc(formId)}">生成草稿</button></div></form></section>`;
    }
    return `<section class="panel compact-panel"><div class="section-title"><h2>${esc(card.title)}</h2></div><p>${esc(card.body || '')}</p></section>`;
  }).join('')}</div>`;
}

function assistantThread() {
  return state.assistant.messages.map((message) => `
    <article class="assistant-message ${message.role}">
      <div class="assistant-bubble">
        <p>${esc(message.text || '')}</p>
        ${message.cards?.length ? renderAssistantCards(message.cards) : ''}
        ${message.citations?.length ? `<div class="assistant-inline-citations">${renderCitations(message.citations)}</div>` : ''}
      </div>
    </article>
  `).join('');
}

async function assistant() {
  const sessions = await getAssistantSessions();
  const approvals = await getAssistantApprovals();
  const pendingApprovals = approvals.filter((item) => item.status === 'pending');
  $('content').innerHTML = `
    <div class="assistant-layout">
      <aside class="assistant-side">
        <section class="panel compact-panel"><div class="section-title"><h2>最近历史</h2><span class="subtle">${sessions.length} 条</span></div>${list(sessions.slice(0, 6), (item) => `<strong>${esc(item.title)}</strong><small>${esc(sceneLabel(item.sceneType || item.scene_type || ''))} · ${fmt(item.updatedAt || item.updated_at)}</small><div class="actions-row"><button class="small-btn" data-assistant-action="load-session" data-session-id="${esc(item.id)}">加载</button></div>`)}</section>
        <section class="panel compact-panel"><div class="section-title"><h2>待审批事项</h2><span class="subtle">${pendingApprovals.length} 条</span></div>${list(pendingApprovals.slice(0, 6), (item) => `<strong>${esc(item.title)}</strong><small>${esc(approvalStatusLabel(item.status))} · ${fmt(item.updatedAt || item.updated_at)}</small><div class="actions-row"><button class="small-btn" data-assistant-action="load-approval" data-approval-id="${esc(item.id)}">打开</button></div>`)}</section>
      </aside>
      <main class="assistant-main">
        <section class="assistant-thread">${assistantThread()}</section>
        <form id="assistantComposer" class="assistant-composer">
          <textarea id="assistantInput" placeholder="直接说你的需求，例如：帮我生成会议纪要；采购审批超过 5 万怎么处理；提交当前草稿审批。"></textarea>
          <div class="actions-row">
            <button type="button" class="small-btn" id="assistantHistoryBtn">查看历史</button>
            <button type="submit" class="accent">发送给助手</button>
          </div>
        </form>
      </main>
    </div>`;

  $('assistantHistoryBtn').onclick = async () => {
    await sendAssistantTurn({ message: '查看我的历史会话和审批事项' });
  };

  $('assistantComposer').onsubmit = async (event) => {
    event.preventDefault();
    const message = $('assistantInput').value.trim();
    if (!message) return;
    $('assistantInput').value = '';
    await sendAssistantTurn({ message });
  };

  document.querySelectorAll('[data-assistant-action]').forEach((btn) => {
    btn.onclick = async () => {
      const action = btn.dataset.assistantAction;
      if (action === 'view-history') {
        await sendAssistantTurn({ message: '查看我的历史会话和审批事项' });
        return;
      }
      if (action === 'submit-approval') {
        if (!state.assistant.currentSession?.id) {
          toast('当前还没有可提交审批的草稿');
          return;
        }
        const note = window.prompt('补充审批说明（可选）', '') ?? '';
        const approval = await submitAssistantApproval(state.assistant.currentSession.id, note);
        state.assistant.currentApproval = approval;
        state.assistant.messages.push({
          role: 'assistant',
          text: `我已经把当前草稿提交审批，状态为：${approvalStatusLabel(approval.status)}。`,
          cards: [{ type: 'approval', title: '审批状态', body: `当前状态：${approvalStatusLabel(approval.status)}`, data: approval }],
          citations: []
        });
        await assistant();
        return;
      }
      if (action === 'load-session') {
        const sessionId = btn.dataset.sessionId;
        const session = await api(`/assistant/sessions/${sessionId}`);
        state.assistant.currentSession = session;
        state.assistant.currentCitations = session.citations || [];
        state.assistant.messages.push({
          role: 'assistant',
          text: `我已经加载历史记录《${session.title}》。`,
          cards: [{ type: 'draft', title: session.title, body: session.summary || '', data: { output: session.output || {}, scene_type: session.sceneType || session.scene_type || '' }, actions: [{ id: 'submit-approval', label: '提交审批' }] }],
          citations: session.citations || []
        });
        await assistant();
        return;
      }
      if (action === 'load-approval') {
        const approvalId = btn.dataset.approvalId;
        const approval = await api(`/approvals/${approvalId}`);
        state.assistant.currentApproval = approval;
        state.assistant.messages.push({
          role: 'assistant',
          text: `我已经打开审批事项《${approval.title}》。`,
          cards: [{ type: 'approval', title: '审批事项', body: approval.summary || '', data: approval }],
          citations: []
        });
        await assistant();
        return;
      }
      if (action === 'open-coverage') {
        await switchView('archive-coverage');
        return;
      }
      if (action === 'open-missing-items') {
        await switchView('missing-items');
        return;
      }
      if (action === 'open-ai-governance') {
        await switchView('ai-governance');
        return;
      }
      if (action === 'open-archive-library') {
        await switchView('archive-library');
      }
    };
  });

  document.querySelectorAll('[data-assistant-approval-status]').forEach((btn) => {
    btn.onclick = async () => {
      const approvalId = btn.dataset.approvalId;
      const status = btn.dataset.assistantApprovalStatus;
      const note = window.prompt(`填写${approvalStatusLabel(status)}意见（可选）`, '') ?? '';
      const approval = await updateAssistantApproval(approvalId, status, note);
      state.assistant.currentApproval = approval;
      state.assistant.messages.push({
        role: 'assistant',
        text: `我已经把审批更新为：${approvalStatusLabel(status)}。`,
        cards: [{ type: 'approval', title: '审批结果', body: `当前状态：${approvalStatusLabel(approval.status)}`, data: approval }],
        citations: []
      });
      await assistant();
    };
  });

  document.querySelectorAll('form[data-assistant-form]').forEach((form) => {
    form.onsubmit = async (event) => {
      event.preventDefault();
      const intent = form.dataset.intent || '';
      const fields = new FormData(form);
      const attachments = {};
      for (const [key, value] of fields.entries()) attachments[key] = value;
      state.assistant.pendingFormValues = attachments;
      await sendAssistantTurn({
        message: `继续处理${sceneLabel(intent)}`,
        attachments,
        context: { intent }
      });
    };
  });
}

async function sendAssistantTurn({ message, attachments = {}, context = {} }) {
  state.assistant.messages.push({ role: 'user', text: message, cards: [], citations: [] });
  const result = await assistantTurn({ message, attachments, context });
  if (result.conversation_id) state.assistant.conversationId = result.conversation_id;
  state.assistant.currentSession = result.session || state.assistant.currentSession;
  state.assistant.currentApproval = result.approval || state.assistant.currentApproval;
  state.assistant.currentCitations = result.citations || [];
  state.assistant.messages.push({
    role: 'assistant',
    text: result.reply,
    cards: result.cards || [],
    citations: result.citations || []
  });
  await assistant();
}

async function workbench() {
  $('content').innerHTML = `
    <section class="panel">
      <div class="section-title"><h2>单助手模式总览</h2><span class="subtle">当前沙盒优先走一个助手入口</span></div>
      <div class="grid cols-3">
        ${metric('主入口', '单助手工作台', '统一完成问答、草稿与审批')}
        ${metric('保留页面', '高级入口', '用于调试场景和联调接口')}
        ${metric('知识管理', '档案 + AI 双层', '文档库、档案库、覆盖看板并存')}
      </div>
      <div class="actions-row">
        <button class="accent switch-view" data-view="assistant">进入单助手</button>
        <button class="small-btn switch-view" data-view="archive-library">查看档案库</button>
        <button class="small-btn switch-view" data-view="upload">上传档案文档</button>
      </div>
    </section>`;
}

async function employeeQa() {
  $('content').innerHTML = `
    <section class="panel">
      <div class="section-title"><h2>员工知识问答入口</h2><span class="subtle">保留的高级入口，主路径建议使用单助手工作台</span></div>
      <textarea id="qaQuestion" placeholder="例如：采购审批超过 5 万怎么处理？">${esc(state.employeeQa.question)}</textarea>
      <div class="actions-row"><button class="accent" id="qaAskBtn">提问</button><button class="small-btn switch-view" data-view="assistant">去单助手</button></div>
    </section>
    <div class="grid cols-2">
      <section class="panel"><div class="section-title"><h2>回答</h2></div><pre class="preview">${esc(state.employeeQa.answer || '等待提问。')}</pre></section>
      <section class="panel"><div class="section-title"><h2>引用来源</h2></div>${renderCitations(state.employeeQa.citations || [])}</section>
    </div>`;
  $('qaAskBtn').onclick = async () => {
    const question = $('qaQuestion').value.trim();
    if (!question) return toast('请输入问题');
    state.employeeQa.question = question;
    const result = await api('/ai/chat', { method: 'POST', body: JSON.stringify({ question, conversation_id: state.employeeQa.conversationId || '' }) });
    state.employeeQa.answer = result.answer || '';
    state.employeeQa.citations = result.citations || [];
    state.employeeQa.conversationId = result.conversation_id || state.employeeQa.conversationId;
    await employeeQa();
  };
}

async function contractReview() {
  $('content').innerHTML = `
    <section class="panel">
      <div class="section-title"><h2>合同对比审查上传页</h2><span class="subtle">建议体验：直接在单助手中发起</span></div>
      <div class="actions-row"><button class="accent switch-view" data-view="assistant">去单助手发起合同审查</button></div>
    </section>`;
}

async function meetingSummary() {
  $('content').innerHTML = `
    <section class="panel">
      <div class="section-title"><h2>会议纪要生成页</h2><span class="subtle">建议体验：直接在单助手中发起</span></div>
      <div class="actions-row"><button class="accent switch-view" data-view="assistant">去单助手生成纪要</button></div>
    </section>`;
}

async function testReport() {
  $('content').innerHTML = `
    <section class="panel">
      <div class="section-title"><h2>测试报告生成页</h2><span class="subtle">建议体验：直接在单助手中发起</span></div>
      <div class="actions-row"><button class="accent switch-view" data-view="assistant">去单助手生成报告</button></div>
    </section>`;
}

async function sessions() {
  const records = await getSceneSessions();
  $('content').innerHTML = `<section class="panel"><div class="section-title"><h2>历史会话页</h2><span class="subtle">共 ${records.length} 条</span></div>${list(records, (item) => `<strong>${esc(item.title)}</strong><small>${esc(sceneLabel(item.sceneType || item.scene_type || ''))} · ${fmt(item.updatedAt || item.updated_at)}</small><p>${esc(item.summary || '')}</p><div class="actions-row"><button class="small-btn" onclick="openSessionDetail('${item.id}')">查看详情</button></div>`)}</section>`;
}

window.openSessionDetail = async (id) => {
  const session = await api(`/scene-sessions/${id}`);
  $('content').innerHTML = `
    <div class="actions-row"><button class="small-btn switch-view" data-view="sessions">返回历史列表</button><button class="accent switch-view" data-view="assistant">回到单助手</button></div>
    <section class="panel"><div class="section-title"><h2>${esc(session.title)}</h2><span class="status ${esc(session.approvalStatus || 'not_submitted')}">${esc(approvalStatusLabel(session.approvalStatus || 'not_submitted'))}</span></div><p>${esc(session.summary || '')}</p>${renderOutputSections(session.output || {})}</section>`;
};

async function approvals() {
  const records = await getApprovals();
  $('content').innerHTML = `<section class="panel"><div class="section-title"><h2>审批确认页</h2><span class="subtle">共 ${records.length} 条</span></div>${list(records, (item) => `<strong>${esc(item.title)}</strong><small>${esc(approvalStatusLabel(item.status))} · ${fmt(item.updatedAt || item.updated_at)}</small><p>${esc(item.summary || '')}</p><div class="actions-row">${item.status === 'pending' && isAdmin() ? `<button class="small-btn" onclick="updateApprovalStatus('${item.id}', 'approved')">通过</button><button class="small-btn warn" onclick="updateApprovalStatus('${item.id}', 'rejected')">退回</button>` : ''}</div>`)}</section>`;
}

async function dashboard() {
  const data = await api('/dashboard');
  $('content').innerHTML = `
    <div class="grid cols-4">
      ${metric('文档总数', data.totals.documents, '文档库')}
      ${metric('用户数', data.totals.users, '登录成员')}
      ${metric('角色数', data.totals.roles, '权限模型')}
      ${metric('部门数', data.totals.departments, '组织范围')}
    </div>
    <section class="panel"><div class="section-title"><h2>最近文档</h2></div>${list(data.recent_documents || [], (d) => `<strong>${esc(d.title)}</strong><small>${esc(d.category)} · ${fmt(d.updated_at)}</small>`)}</section>`;
}

async function loadDocumentsFromInputs() {
  const params = new URLSearchParams();
  ['q', 'category', 'tag', 'owner_id', 'department_id', 'status', 'visibility'].forEach((key) => {
    const node = document.querySelector(`[data-filter="${key}"]`);
    if (node && node.value) params.set(key, node.value);
  });
  const data = await api(`/documents?${params.toString()}`);
  state.documents = data.documents;
  state.filters = data.filters;
  return data;
}

async function documents() {
  const data = await api('/documents');
  state.documents = data.documents;
  state.filters = data.filters;
  renderDocumentLibrary();
}

function renderDocumentLibrary() {
  const documentFilter = (label, control) => `<label class="filter-field"><span class="subtle">${label}</span>${control}</label>`;
  $('content').innerHTML = `
    <div class="toolbar">
      ${documentFilter('搜索', '<input data-filter="q" placeholder="搜索标题、文件名、标签" />')}
      ${documentFilter('分类', `<select data-filter="category">${optionList(state.filters.categories || [])}</select>`)}
      ${documentFilter('标签', `<select data-filter="tag">${optionList(state.filters.tags || [])}</select>`)}
      ${documentFilter('上传人', `<select data-filter="owner_id">${optionList(state.ref.users)}</select>`)}
      ${documentFilter('状态', `<select data-filter="status">${optionList(state.filters.statuses || [])}</select>`)}
      ${documentFilter('可见级别', `<select data-filter="visibility">${optionList(state.filters.visibilities || [])}</select>`)}
    </div>
    <div class="actions-row">
      <button id="applyFilters">应用筛选</button>
      <button id="clearFilters">清空筛选</button>
      <button id="batchArchive">批量归档</button>
      <button id="batchDelete">批量删除</button>
      <button id="batchReindex">重新索引</button>
      <button id="batchDifySync">同步到 Dify</button>
      <button id="batchDifyRefresh">刷新 Dify 状态</button>
      <button class="accent switch-view" data-view="upload">上传文档</button>
    </div>
    <div class="table-wrap">${documentTable(state.documents)}</div>`;
  $('applyFilters').onclick = async () => { await loadDocumentsFromInputs(); renderDocumentLibrary(); };
  $('clearFilters').onclick = () => switchView('documents');
  $('batchArchive').onclick = () => batch('/documents/batch/archive', '已归档');
  $('batchDelete').onclick = () => batch('/documents/batch/delete', '已删除');
  $('batchReindex').onclick = () => batch('/documents/batch/reindex', '索引任务已创建');
  $('batchDifySync').onclick = () => batch('/documents/batch/sync-to-dify', 'Dify 同步任务已提交');
  $('batchDifyRefresh').onclick = () => batch('/documents/batch/refresh-dify-status', 'Dify 状态已刷新');
}

function documentTable(docs) {
  if (!docs.length) return '<p class="subtle">暂无文档，先上传一个文件。</p>';
  return `<table><thead><tr><th></th><th>文档</th><th>分类 / 标签</th><th>上传人</th><th>状态</th><th>Dify</th><th>可见级别</th><th>质量</th><th>操作</th></tr></thead><tbody>
    ${docs.map((d) => `<tr>
      <td><input type="checkbox" onchange="toggleSelect('${d.id}', this.checked)"></td>
      <td><strong>${esc(d.title)}</strong><br><small class="subtle">${esc(d.file_name)} · v${d.version} · ${Math.ceil((d.size_bytes || 0) / 1024)}KB</small></td>
      <td>${esc(d.category)}<br>${(d.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}</td>
      <td>${esc(d.owner_name)}<br><small class="subtle">${esc(d.department_name)}</small></td>
      <td><span class="status ${d.status}">${esc(d.status)}</span><br><small class="subtle">${esc(d.index_status || 'pending')} · parse: ${esc(d.parse_status || '-')}</small></td>
      <td><span class="status ${d.dify_sync_status || 'not_synced'}">${esc(d.dify_sync_status || 'not_synced')}</span><br><small class="subtle">${esc(d.dify_indexing_status || '-')}</small></td>
      <td>${esc(d.visibility)}</td>
      <td>${d.quality_score || 0}</td>
      <td><button class="small-btn" onclick="openDetail('${d.id}')">详情/预览</button></td>
    </tr>`).join('')}</tbody></table>`;
}

window.toggleSelect = (id, checked) => checked ? state.selected.add(id) : state.selected.delete(id);
window.selectPermissionDocument = async (id) => {
  state.selectedPermissionDocumentId = id;
  await permissions();
};

async function batch(path, message) {
  const ids = [...state.selected];
  if (!ids.length) return toast('请先选择文档');
  await api(path, { method: 'POST', body: JSON.stringify({ ids }) });
  state.selected.clear();
  toast(message);
  await switchView(state.view === 'archive-library' ? 'archive-library' : 'documents');
}

window.openDetail = async (id) => {
  const [doc, scopes, catalogs, catalogItems, mappings] = await Promise.all([
    api(`/archive/documents/${id}`),
    api('/archive/scopes'),
    api('/archive/catalogs'),
    api('/archive/catalog-items'),
    api('/knowledge/datasets/mapping')
  ]);
  const relatedDocs = doc.catalog_item?.id ? await api(`/archive/catalog-items/${doc.catalog_item.id}/documents`) : null;
  $('sectionTitle').textContent = '文档详情';
  $('sectionKicker').textContent = 'Document Detail';
  $('content').innerHTML = `
    <div class="actions-row"><button class="small-btn switch-view" data-view="archive-library">返回档案库</button><button class="small-btn switch-view" data-view="documents">返回文档库</button><button id="detailReindex" class="accent">重新索引</button><button id="detailDifySync" class="small-btn">同步到 Dify</button><button id="detailDifyRefresh" class="small-btn">刷新 Dify 状态</button></div>
    <div class="detail-layout">
      <section class="panel">
        <div class="section-title"><h2>${esc(doc.title)}</h2><span class="status ${doc.status}">${esc(doc.status)}</span></div>
        <div class="grid cols-4">${metric('版本', `v${doc.version}`, `${doc.version_count} 条历史`)}${metric('权限', doc.visibility, doc.department_name)}${metric('解析', doc.parse_status || '-', doc.parser || doc.parse_error || '-')}${metric('Dify', syncStatusLabel(doc.knowledge_sync_status || doc.dify_sync_status || 'not_synced'), doc.dify_indexing_status || '未同步')}</div>
        <div class="grid cols-4">${metric('归档状态', archiveStatusLabel(doc.filing_status), doc.archive_category || '-')}${metric('组织范围', doc.org_unit_id || '-', doc.org_path || '-')}${metric('AI 可用', boolLabel(doc.ai_enabled), aiScopeLabel(doc.ai_usage_scope))}${metric('密级', doc.confidentiality_level || '-', doc.compliance_status || '-')}</div>
        <div class="section-title"><h2>档案治理信息</h2><span class="subtle">围绕目录匹配、责任人、AI 审核和数据集映射展开</span></div>
        <div class="list-item"><div><strong>目录匹配</strong><p>${esc(doc.catalog_item?.document_name_rule || '未匹配目录项')}</p><small>模板：${esc(doc.catalog?.name || '-')} · 目录项 ID：${esc(doc.archive_catalog_id || '-')} · 匹配规则：${esc(doc.catalog_item?.matching_rule || '-')}</small></div></div>
        <div class="list-item"><div><strong>责任人</strong><p>档案责任人：${esc(userNameById(doc.archive_owner_id))}</p><small>复核责任人：${esc(userNameById(doc.review_owner_id))} · 最近复核时间：${esc(fmt(doc.last_reviewed_at || ''))}</small></div></div>
        <div class="list-item"><div><strong>最近 AI 审核</strong><p>${esc(reviewStatusLabel(doc.latest_ai_review?.status || doc.ai_review_status || 'pending'))}</p><small>审核人：${esc(doc.latest_ai_review?.actor_name || doc.last_ai_reviewed_by || '-')} · 时间：${esc(fmt(doc.latest_ai_review?.created_at || doc.last_ai_reviewed_at || ''))} · 备注：${esc(doc.latest_ai_review?.note || doc.ai_review_note || '-')} · 阻断：${esc(doc.latest_ai_review?.block_reason || doc.ai_block_reason || '-')}</small></div></div>
        <div class="list-item"><div><strong>Dataset 映射</strong><p>当前 dataset_key：${esc(doc.knowledge_dataset_key || '-')}</p><small>命中映射：${esc(doc.dataset_mapping?.dataset_name || doc.dataset_mapping?.dataset_key || '未命中')} · 用途：${esc(aiScopeLabel(doc.dataset_mapping?.ai_usage_scope || doc.ai_usage_scope))}</small></div></div>
        <div class="list-item"><div><strong>AI 准入判断</strong><p><span class="status ${aiGateStatusClass(doc)}">${esc(aiGateLabel(doc))}</span></p><small>${esc(doc.ai_gate_block_reason || '当前文档满足 AI 入库条件')}</small></div></div>
        <div class="section-title"><h2>相关审计片段</h2><span class="subtle">仅展示 archive / ai-governance / dify 域</span></div>
        ${list(doc.related_audit_logs || [], (item) => `<strong>${esc(item.action || '-')}</strong><small>${esc(item.actor || '-')} · ${fmt(item.created_at)}</small><p>${esc(item.detail || '-')}</p>`)}
        <div class="section-title"><h2>文档预览</h2><span class="subtle">预览内容来自后端解析文本；原文件仍保存在 documents/original</span></div>
        <pre class="preview">${esc(doc.content_text || '暂无可预览文本。')}</pre>
      </section>
      <section class="panel">
        <div class="section-title"><h2>编辑元数据与治理字段</h2></div>
        <div class="form-grid">
          <label>标题<input id="editTitle" value="${esc(doc.title)}"></label>
          <label>分类<input id="editCategory" value="${esc(doc.category)}"></label>
          <label>标签<input id="editTags" value="${esc((doc.tags || []).join(', '))}"></label>
          <label>可见级别<select id="editVisibility">${optionList(state.filters.visibilities || ['public', 'department', 'role', 'private', 'admin'], doc.visibility, false)}</select></label>
          <label>组织单元<select id="editOrgUnit">${optionList(state.ref.departments, doc.org_unit_id || doc.department_id || 'dept-ops', false)}</select></label>
          <label>组织路径<input id="editOrgPath" value="${esc(doc.org_path || '')}" placeholder="/集团总部/财务部"></label>
          <label>档案模板<select id="editCatalogTemplate"></select></label>
          <label>匹配目录项<select id="matchCatalogItem"></select></label>
          <label>档案分类<input id="editArchiveCategory" value="${esc(doc.archive_category || '')}"></label>
          <label>档案路径<input id="editArchivePath" value="${esc(doc.archive_path || '')}" placeholder="财务部/2026/制度"></label>
          <label>文档类型<input id="editDocumentType" value="${esc(doc.document_type || '')}"></label>
          <label>归档年度<input id="editFilingYear" value="${esc(doc.filing_year || '')}"></label>
          <label>归档状态<select id="editFilingStatus">${optionList(['unfiled', 'filed', 'pending', 'void'], doc.filing_status || 'unfiled', false)}</select></label>
          <label>AI 用途<select id="editAiUsageScope">${optionList(['archive_only', 'ai_search', 'ai_answer'], doc.ai_usage_scope || 'archive_only', false)}</select></label>
          <label>AI 可用<select id="editAiEnabled">${optionList([{ id: 'true', name: '是' }, { id: 'false', name: '否' }], String(!!doc.ai_enabled), false)}</select></label>
          <label>同步状态<select id="editKnowledgeSyncStatus">${optionList(['disabled', 'pending', 'synced', 'failed'], doc.knowledge_sync_status || 'disabled', false)}</select></label>
          <label>密级<select id="editConfidentiality">${optionList(['public', 'internal', 'department', 'sensitive', 'restricted'], doc.confidentiality_level || 'internal', false)}</select></label>
          <label>Dataset 标识<input id="editDatasetKey" value="${esc(doc.knowledge_dataset_key || '')}"></label>
          <label>命中 dataset 映射<select id="datasetMappingPreview">${optionList((mappings.mappings || []).map((item) => ({ id: item.id, name: `${item.dataset_name || item.dataset_key} / ${item.scope_name || item.scope_id || '全局'}` })), doc.dataset_mapping?.id || '', false)}</select></label>
          <label class="wide">正文内容编辑区<textarea id="editContent">${esc(doc.content_text || '')}</textarea></label>
        </div>
        <div class="actions-row"><button id="saveDoc" class="accent">保存修改并生成新版本</button><button id="matchCatalogBtn" class="small-btn">匹配到目录项</button>${doc.catalog_item?.id ? '<button id="viewCatalogDocs" class="small-btn">查看该目录项文档</button>' : ''}</div>
        ${relatedDocs ? `<div class="section-title"><h2>同目录项文档</h2></div>${list(relatedDocs.documents || [], (item) => `<strong>${esc(item.title)}</strong><small>${esc(item.department_name || '-')} · ${esc(archiveStatusLabel(item.filing_status))}</small><div class="actions-row"><button class="small-btn" onclick="openDetail('${item.id}')">打开详情</button></div>`)} ` : ''}
        <div class="section-title"><h2>版本历史</h2></div>${list(doc.versions || [], (v) => `<strong>v${v.version} · ${esc(v.file_name)}</strong><small>${Math.ceil((v.size_bytes || 0) / 1024)}KB · ${fmt(v.created_at)}</small>`)}
      </section>
    </div>`;

  const syncDetailCatalogOptions = () => {
    const scopeId = $('editOrgUnit').value;
    const visibleCatalogs = (catalogs || []).filter((item) => item.scope_id === scopeId && item.status !== 'disabled');
    const preferredCatalogId = $('editCatalogTemplate').dataset.selected || doc.catalog?.id || doc.catalog_item?.catalog_id || '';
    $('editCatalogTemplate').innerHTML = optionList(visibleCatalogs.map((item) => ({ id: item.id, name: item.name })), preferredCatalogId, false);
    const currentCatalogId = $('editCatalogTemplate').value;
    const visibleItems = (catalogItems || []).filter((item) => item.scope_id === scopeId && item.status !== 'disabled' && (!currentCatalogId || item.catalog_id === currentCatalogId));
    const preferredItemId = $('matchCatalogItem').dataset.selected || doc.archive_catalog_id || doc.catalog_item?.id || '';
    $('matchCatalogItem').innerHTML = optionList(visibleItems.map((item) => ({ id: item.id, name: `${item.document_name_rule} (${item.category})` })), preferredItemId, false);
    const scopePath = findOrgPath(scopes, scopeId);
    if (scopePath) $('editOrgPath').value = scopePath;
  };

  const syncDetailItemDefaults = () => {
    const selectedItem = (catalogItems || []).find((item) => item.id === $('matchCatalogItem').value);
    if (!selectedItem) return;
    $('editArchiveCategory').value = selectedItem.category || $('editArchiveCategory').value;
    $('editDocumentType').value = selectedItem.subcategory || $('editDocumentType').value;
    $('editCatalogTemplate').dataset.selected = selectedItem.catalog_id || $('editCatalogTemplate').value || '';
  };

  $('editCatalogTemplate').dataset.selected = doc.catalog?.id || doc.catalog_item?.catalog_id || '';
  $('matchCatalogItem').dataset.selected = doc.archive_catalog_id || doc.catalog_item?.id || '';
  $('editOrgUnit').addEventListener('change', () => {
    $('editCatalogTemplate').dataset.selected = '';
    $('matchCatalogItem').dataset.selected = '';
    syncDetailCatalogOptions();
  });
  $('editCatalogTemplate').addEventListener('change', () => {
    $('matchCatalogItem').dataset.selected = '';
    syncDetailCatalogOptions();
    syncDetailItemDefaults();
  });
  $('matchCatalogItem').addEventListener('change', syncDetailItemDefaults);
  syncDetailCatalogOptions();
  syncDetailItemDefaults();

  $('saveDoc').onclick = async () => {
    await api(`/documents/${doc.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: $('editTitle').value,
        category: $('editCategory').value,
        tags: $('editTags').value.split(',').map((x) => x.trim()).filter(Boolean),
        visibility: $('editVisibility').value,
        org_unit_id: $('editOrgUnit').value,
        org_path: $('editOrgPath').value,
        archive_category: $('editArchiveCategory').value,
        archive_path: $('editArchivePath').value,
        document_type: $('editDocumentType').value,
        filing_year: $('editFilingYear').value,
        filing_status: $('editFilingStatus').value,
        ai_usage_scope: $('editAiUsageScope').value,
        ai_enabled: $('editAiEnabled').value === 'true',
        knowledge_sync_status: $('editKnowledgeSyncStatus').value,
        confidentiality_level: $('editConfidentiality').value,
        knowledge_dataset_key: $('editDatasetKey').value,
        content_text: $('editContent').value
      })
    });
    toast('文档已更新');
    openDetail(doc.id);
  };
  $('matchCatalogBtn').onclick = async () => {
    const itemId = $('matchCatalogItem').value;
    if (!itemId) return toast('请先选择目录项');
    await api(`/archive/documents/${doc.id}/match-catalog`, {
      method: 'POST',
      body: JSON.stringify({ item_id: itemId })
    });
    toast('目录项匹配已更新');
    openDetail(doc.id);
  };
  if ($('viewCatalogDocs')) {
    $('viewCatalogDocs').onclick = async () => {
      const itemId = doc.catalog_item?.id;
      if (!itemId) return;
      const related = await api(`/archive/catalog-items/${itemId}/documents`);
      $('content').insertAdjacentHTML('afterbegin', `<section class="panel"><div class="section-title"><h2>目录项文档列表</h2><span class="subtle">共 ${related.total || 0} 个</span></div>${list(related.documents || [], (item) => `<strong>${esc(item.title)}</strong><small>${esc(item.department_name || '-')} · ${esc(syncStatusLabel(item.knowledge_sync_status || item.dify_sync_status))}</small><div class="actions-row"><button class="small-btn" onclick="openDetail('${item.id}')">打开详情</button></div>`)}</section>`);
    };
  }
  $('detailReindex').onclick = async () => {
    await api('/documents/batch/reindex', { method: 'POST', body: JSON.stringify({ ids: [doc.id] }) });
    toast('索引任务已完成');
    openDetail(doc.id);
  };
  $('detailDifySync').onclick = async () => {
    try {
      await api(`/documents/${doc.id}/sync-to-dify`, { method: 'POST', body: JSON.stringify({}) });
      toast('已同步到 Dify');
      openDetail(doc.id);
    } catch (err) {
      toast(err.message);
    }
  };
  $('detailDifyRefresh').onclick = async () => {
    try {
      await api(`/documents/${doc.id}/refresh-dify-status`, { method: 'POST', body: JSON.stringify({}) });
      toast('Dify 状态已刷新');
      openDetail(doc.id);
    } catch (err) {
      toast(err.message);
    }
  };
};

async function upload() {
  const [tree, catalogs, items] = await Promise.all([
    api('/archive/scopes'),
    api('/archive/catalogs'),
    api('/archive/catalog-items')
  ]);
  const prefill = state.uploadPrefill || null;
  const defaultScopeId = prefill?.org_unit_id || state.user?.department_id || state.ref.departments[0]?.id || '';
  const scopePath = findOrgPath(tree, defaultScopeId);
  const scopeCatalogs = (catalogs || []).filter((item) => item.scope_id === defaultScopeId && item.status !== 'disabled');
  const scopeItems = (items || []).filter((item) => item.scope_id === defaultScopeId && item.status !== 'disabled');
  $('content').innerHTML = `
    <form id="uploadForm" class="upload-grid">
      <section class="dropzone"><div><h2>选择或拖入文件</h2><p class="subtle">支持 txt/md/csv/json/html/PDF/DOCX/XLSX。系统会保存原始文件，并提取文本用于预览和同步 Dify。</p><input id="fileInput" type="file"></div></section>
      <section class="panel form-grid">
        <label>标题<input id="docTitle" value="${esc(prefill?.title || '')}" placeholder="例如：采购审批制度"></label>
        <label>分类<input id="docCategory" value="${esc(prefill?.category || '制度文档')}"></label>
        <label>标签<input id="docTags" value="${esc((prefill?.tags || []).join(', '))}" placeholder="ERP, 财务, 流程"></label>
        <label>上传人<select id="docOwner">${optionList(state.ref.users, prefill?.owner_id || state.user?.id || 'u-admin', false)}</select></label>
        <label>部门<select id="docDept">${optionList(state.ref.departments, prefill?.department_id || state.user?.department_id || 'dept-ops', false)}</select></label>
        <label>可见级别<select id="docVisibility">${optionList(['public', 'department', 'role', 'private', 'admin'], prefill?.visibility || 'department', false)}</select></label>
        <label>组织单元<select id="docOrgUnit">${optionList(state.ref.departments, defaultScopeId, false)}</select></label>
        <label>组织路径<input id="docOrgPath" value="${esc(prefill?.org_path || scopePath)}" placeholder="例如：/集团总部/财务部"></label>
        <label>档案模板<select id="docCatalogTemplate">${optionList(scopeCatalogs.map((item) => ({ id: item.id, name: item.name })), prefill?.catalog_id || '', false)}</select></label>
        <label>档案目录项<select id="docCatalogId">${optionList(scopeItems.map((item) => ({ id: item.id, name: `${item.document_name_rule} (${item.category})` })), prefill?.archive_catalog_id || '', false)}</select></label>
        <label>档案分类<input id="docArchiveCategory" value="${esc(prefill?.archive_category || '制度')}"></label>
        <label>档案路径<input id="docArchivePath" value="${esc(prefill?.archive_path || '')}" placeholder="例如：财务部/2026/制度"></label>
        <label>文档类型<input id="docType" value="${esc(prefill?.document_type || '通用文档')}"></label>
        <label>文档编码<input id="docCode" value="${esc(prefill?.document_code || '')}" placeholder="例如：FIN-2026-001"></label>
        <label>归档年度<input id="docFilingYear" value="${esc(prefill?.filing_year || '2026')}"></label>
        <label>归档周期<input id="docFilingPeriod" value="${esc(prefill?.filing_period || '年度')}"></label>
        <label>保管期限<input id="docRetention" value="${esc(prefill?.retention_period || '长期')}"></label>
        <label>归档状态<select id="docFilingStatus">${optionList(['unfiled', 'filed', 'pending', 'void'], prefill?.filing_status || 'unfiled', false)}</select></label>
        <label>密级<select id="docConfidentiality">${optionList(['public', 'internal', 'department', 'sensitive', 'restricted'], prefill?.confidentiality_level || 'internal', false)}</select></label>
        <label>AI 用途<select id="docAiScope">${optionList(['archive_only', 'ai_search', 'ai_answer'], prefill?.ai_usage_scope || 'archive_only', false)}</select></label>
        <label>知识库标识<input id="docDatasetKey" value="${esc(prefill?.knowledge_dataset_key || '')}" placeholder="例如：finance-policy-kb"></label>
        <label>规则来源<input id="docRequiredRuleSource" value="${esc(prefill?.required_rule_source || '')}" placeholder="例如：核心知识文档清单"></label>
        <label>档案责任人<select id="docArchiveOwner">${optionList(state.ref.users, prefill?.archive_owner_id || state.user?.id || 'u-admin', false)}</select></label>
        <label>复核责任人<select id="docReviewOwner">${optionList(state.ref.users, prefill?.review_owner_id || '', false)}</select></label>
        <label>AI 可用
          <select id="docAiEnabled">${optionList([{ id: 'true', name: '是' }, { id: 'false', name: '否' }], String(!!prefill?.ai_enabled), false)}</select>
        </label>
        <label>必传文件
          <select id="docIsRequired">${optionList([{ id: 'true', name: '是' }, { id: 'false', name: '否' }], String(!!prefill?.is_required), false)}</select>
        </label>
        <label>需脱敏
          <select id="docRedactionRequired">${optionList([{ id: 'true', name: '是' }, { id: 'false', name: '否' }], String(!!prefill?.redaction_required), false)}</select>
        </label>
        <label>合规状态<input id="docComplianceStatus" value="${esc(prefill?.compliance_status || 'compliant')}"></label>
        <label class="wide">本地文本预览<textarea id="docContent" placeholder="文本类文件会在浏览器中预览；PDF/DOCX/XLSX 由后端解析"></textarea></label>
        <div class="wide actions-row"><button class="accent" type="submit">上传原文件并解析</button><button type="button" class="small-btn switch-view" data-view="archive-library">查看档案库</button></div>
      </section>
    </form>`;

  const syncUploadCatalogOptions = () => {
    const scopeId = $('docOrgUnit').value;
    const visibleCatalogs = (catalogs || []).filter((item) => item.scope_id === scopeId && item.status !== 'disabled');
    const selectedTemplateId = $('docCatalogTemplate').dataset.selected || $('docCatalogTemplate').value;
    $('docCatalogTemplate').innerHTML = optionList(visibleCatalogs.map((item) => ({ id: item.id, name: item.name })), selectedTemplateId, false);
    const currentTemplateId = $('docCatalogTemplate').value;
    const visibleItems = (items || []).filter((item) => item.scope_id === scopeId && item.status !== 'disabled' && (!currentTemplateId || item.catalog_id === currentTemplateId));
    const selectedItemId = $('docCatalogId').dataset.selected || $('docCatalogId').value;
    $('docCatalogId').innerHTML = optionList(visibleItems.map((item) => ({ id: item.id, name: `${item.document_name_rule} (${item.category})` })), selectedItemId, false);
    const scope = (state.ref.departments || []).find((item) => item.id === scopeId);
    $('docDept').value = scopeId;
    $('docOrgPath').value = findOrgPath(tree, scopeId) || $('docOrgPath').value || '';
    if (scope && !$('docArchivePath').value.trim()) {
      $('docArchivePath').value = `${scope.name}/${$('docFilingYear').value || '2026'}/${$('docArchiveCategory').value || '制度'}`;
    }
  };

  const syncUploadItemDefaults = () => {
    const selectedItem = (items || []).find((item) => item.id === $('docCatalogId').value);
    if (!selectedItem) return;
    $('docArchiveCategory').value = selectedItem.category || $('docArchiveCategory').value;
    $('docType').value = selectedItem.subcategory || $('docType').value;
    $('docFilingPeriod').value = selectedItem.archive_period || $('docFilingPeriod').value;
    $('docRetention').value = selectedItem.retention_policy || $('docRetention').value;
    $('docIsRequired').value = String(!!selectedItem.required);
    $('docAiEnabled').value = String(!!selectedItem.default_ai_enabled);
    $('docAiScope').value = selectedItem.default_ai_usage_type || $('docAiScope').value;
    $('docRequiredRuleSource').value = selectedItem.document_name_rule || $('docRequiredRuleSource').value;
  };

  $('docCatalogTemplate').dataset.selected = prefill?.catalog_id || '';
  $('docCatalogId').dataset.selected = prefill?.archive_catalog_id || '';
  $('docOrgUnit').addEventListener('change', () => {
    $('docCatalogTemplate').dataset.selected = '';
    $('docCatalogId').dataset.selected = '';
    syncUploadCatalogOptions();
  });
  $('docCatalogTemplate').addEventListener('change', () => {
    $('docCatalogId').dataset.selected = '';
    syncUploadCatalogOptions();
    syncUploadItemDefaults();
  });
  $('docCatalogId').addEventListener('change', syncUploadItemDefaults);
  syncUploadCatalogOptions();
  syncUploadItemDefaults();
  state.uploadPrefill = null;

  $('fileInput').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    $('docTitle').value = $('docTitle').value || file.name.replace(/\.[^.]+$/, '');
    if (/text|json|csv|markdown|xml|javascript|css|html/.test(file.type) || /\.(txt|md|csv|json|log|xml)$/i.test(file.name)) {
      $('docContent').value = await file.text();
    } else {
      $('docContent').value = '';
      toast('非文本文件已选择，将由后端解析器处理');
    }
  });
  $('uploadForm').onsubmit = async (event) => {
    event.preventDefault();
    const file = $('fileInput').files[0];
    if (!file) return toast('请先选择文件');
    const form = new FormData();
    form.append('file', file);
    form.append('title', $('docTitle').value || file.name || '未命名文档');
    form.append('category', $('docCategory').value || 'General');
    form.append('tags', $('docTags').value);
    form.append('owner_id', $('docOwner').value);
    form.append('department_id', $('docDept').value);
    form.append('visibility', $('docVisibility').value);
    form.append('org_unit_id', $('docOrgUnit').value);
    form.append('org_path', $('docOrgPath').value);
    form.append('archive_catalog_id', $('docCatalogId').value);
    form.append('archive_category', $('docArchiveCategory').value);
    form.append('archive_path', $('docArchivePath').value);
    form.append('document_code', $('docCode').value);
    form.append('document_type', $('docType').value);
    form.append('filing_year', $('docFilingYear').value);
    form.append('filing_period', $('docFilingPeriod').value);
    form.append('retention_period', $('docRetention').value);
    form.append('filing_status', $('docFilingStatus').value);
    form.append('confidentiality_level', $('docConfidentiality').value);
    form.append('ai_usage_scope', $('docAiScope').value);
    form.append('knowledge_dataset_key', $('docDatasetKey').value);
    form.append('required_rule_source', $('docRequiredRuleSource').value);
    form.append('archive_owner_id', $('docArchiveOwner').value);
    form.append('review_owner_id', $('docReviewOwner').value);
    form.append('ai_enabled', $('docAiEnabled').value === 'true' ? 'true' : 'false');
    form.append('is_required', $('docIsRequired').value === 'true' ? 'true' : 'false');
    form.append('redaction_required', $('docRedactionRequired').value === 'true' ? 'true' : 'false');
    form.append('compliance_status', $('docComplianceStatus').value);
    const doc = await api('/documents/upload', { method: 'POST', body: form });
    toast(`文档已上传，解析状态：${doc.parse_status || 'unknown'}`);
    await openDetail(doc.id);
  };
}

async function archiveLibrary() {
  const data = await api('/archive/documents');
  state.documents = data.documents;
  state.filters = data.filters;
  renderArchiveLibrary();
}

async function loadArchiveDocumentsFromInputs() {
  const params = new URLSearchParams();
  ['q', 'department_id', 'org_unit_id', 'archive_category', 'document_type', 'filing_year', 'filing_status', 'ai_enabled', 'knowledge_sync_status', 'confidentiality_level'].forEach((key) => {
    const node = document.querySelector(`[data-archive-filter="${key}"]`);
    if (node && node.value) params.set(key, node.value);
  });
  const data = await api(`/archive/documents?${params.toString()}`);
  const catalogId = document.querySelector('[data-archive-filter="catalog_id"]')?.value || '';
  const required = document.querySelector('[data-archive-filter="required"]')?.value || '';
  const aiGateAllowed = document.querySelector('[data-archive-filter="ai_gate_allowed"]')?.value || '';
  let documents = data.documents || [];
  if (catalogId) documents = documents.filter((doc) => String(doc.archive_catalog_id || '') === catalogId);
  if (required === 'true') documents = documents.filter((doc) => !!doc.is_required);
  if (required === 'false') documents = documents.filter((doc) => !doc.is_required);
  if (aiGateAllowed === 'true') documents = documents.filter((doc) => !!doc.ai_gate_allowed);
  if (aiGateAllowed === 'false') documents = documents.filter((doc) => !doc.ai_gate_allowed);
  state.documents = documents;
  state.filters = data.filters;
  return { ...data, documents, total: documents.length };
}

function renderArchiveLibrary() {
  const catalogOptions = Array.from(new Map((state.documents || []).filter((doc) => doc.archive_catalog_id).map((doc) => [doc.archive_catalog_id, { id: doc.archive_catalog_id, name: `${doc.catalog_item?.document_name_rule || doc.archive_catalog_id} / ${doc.department_name || '-'}` }])).values());
  const archiveFilter = (label, control) => `<label class="filter-field"><span class="subtle">${label}</span>${control}</label>`;
  $('content').innerHTML = `
    <div class="toolbar">
      ${archiveFilter('搜索', '<input data-archive-filter="q" placeholder="搜索标题、档案路径、编码、组织路径" />')}
      ${archiveFilter('所属部门', `<select data-archive-filter="department_id">${optionList(state.ref.departments)}</select>`)}
      ${archiveFilter('档案分类', `<select data-archive-filter="archive_category">${optionList(state.filters.archive_categories || [])}</select>`)}
      ${archiveFilter('文档类型', `<select data-archive-filter="document_type">${optionList(state.filters.document_types || [])}</select>`)}
      ${archiveFilter('归档年度', `<select data-archive-filter="filing_year">${optionList(state.filters.filing_years || [])}</select>`)}
      ${archiveFilter('归档状态', `<select data-archive-filter="filing_status">${optionList(state.filters.filing_statuses || [])}</select>`)}
      ${archiveFilter('AI 是否可用', `<select data-archive-filter="ai_enabled">${optionList([{ id: 'true', name: 'AI 可用' }, { id: 'false', name: 'AI 禁用' }])}</select>`)}
      ${archiveFilter('知识同步状态', `<select data-archive-filter="knowledge_sync_status">${optionList(state.filters.knowledge_sync_statuses || [])}</select>`)}
      ${archiveFilter('密级', `<select data-archive-filter="confidentiality_level">${optionList(state.filters.confidentiality_levels || [])}</select>`)}
      ${archiveFilter('对应目录项', `<select data-archive-filter="catalog_id">${optionList(catalogOptions)}</select>`)}
      ${archiveFilter('是否必传', `<select data-archive-filter="required">${optionList([{ id: 'true', name: '必传' }, { id: 'false', name: '非必传' }])}</select>`)}
      ${archiveFilter('AI 准入结果', `<select data-archive-filter="ai_gate_allowed">${optionList([{ id: 'true', name: '允许进入 AI' }, { id: 'false', name: '已阻断' }])}</select>`)}
    </div>
    <div class="actions-row">
      <button id="applyArchiveFilters">应用筛选</button>
      <button id="clearArchiveFilters">清空筛选</button>
      <button id="archiveBatchReindex">重新索引</button>
      <button id="archiveBatchDifySync">同步到 Dify</button>
      <button id="archiveBatchArchive">批量归档</button>
      <button class="accent switch-view" data-view="upload">上传档案文档</button>
    </div>
    <div class="table-wrap">${archiveTable(state.documents)}</div>`;
  $('applyArchiveFilters').onclick = async () => { await loadArchiveDocumentsFromInputs(); renderArchiveLibrary(); };
  $('clearArchiveFilters').onclick = () => switchView('archive-library');
  $('archiveBatchReindex').onclick = () => batch('/documents/batch/reindex', '索引任务已创建');
  $('archiveBatchDifySync').onclick = () => batch('/documents/batch/sync-to-dify', 'Dify 同步任务已提交');
  $('archiveBatchArchive').onclick = () => batch('/documents/batch/archive', '已批量归档');
}

function archiveTable(docs) {
  if (!docs.length) return '<p class="subtle">暂无档案文档，先上传一个文件。</p>';
  return `<table><thead><tr><th></th><th>文档</th><th>组织 / 路径</th><th>档案治理</th><th>AI 治理</th><th>密级 / 合规</th><th>操作</th></tr></thead><tbody>
    ${docs.map((d) => `<tr>
      <td><input type="checkbox" onchange="toggleSelect('${d.id}', this.checked)"></td>
      <td><strong>${esc(d.title)}</strong><br><small class="subtle">${esc(d.file_name)} · ${esc(d.document_code || '-')} · ${esc(d.filing_year || '-')}</small></td>
      <td>${esc(d.department_name || '-')}<br><small class="subtle">${esc(d.org_path || d.archive_path || '-')}</small></td>
      <td><span class="status ${esc(d.filing_status || 'unfiled')}">${esc(archiveStatusLabel(d.filing_status))}</span><br><small class="subtle">${esc(d.archive_category || '-')} · ${esc(d.document_type || '-')} · 必传:${esc(boolLabel(d.is_required))}</small></td>
      <td><span class="status ${d.ai_enabled ? 'indexed' : 'archived'}">${esc(boolLabel(d.ai_enabled))}</span><br><small class="subtle">${esc(aiScopeLabel(d.ai_usage_scope))} · ${esc(syncStatusLabel(d.knowledge_sync_status || d.dify_sync_status))}</small></td>
      <td>${esc(d.confidentiality_level || '-')}<br><small class="subtle">${esc(d.compliance_status || '-')}</small></td>
      <td><button class="small-btn" onclick="openDetail('${d.id}')">治理详情</button></td>
    </tr>`).join('')}</tbody></table>`;
}

async function archiveCoverage() {
  const rows = await api('/archive/coverage');
  state.archiveCoverageRows = rows;
  if (!state.selectedCoverageScopeId && rows[0]?.scope_id) state.selectedCoverageScopeId = rows[0].scope_id;
  if (state.selectedCoverageScopeId) {
    try {
      state.selectedCoverageDetail = await api(`/archive/coverage/${state.selectedCoverageScopeId}`);
    } catch {
      state.selectedCoverageDetail = null;
    }
  }
  const detail = state.selectedCoverageDetail;
  $('content').innerHTML = `
    <section class="panel">
      <div class="section-title"><h2>档案覆盖看板</h2><span class="subtle">按部门查看必传档案覆盖率与 AI 使用状态</span></div>
      <div class="grid cols-4">
        ${metric('部门数', rows.length, '覆盖范围')}
        ${metric('平均覆盖率', rows.length ? `${(rows.reduce((sum, item) => sum + Number(item.coverage_rate || 0), 0) / rows.length).toFixed(1)}%` : '0%', '必传项完成度')}
        ${metric('AI 可用总数', rows.reduce((sum, item) => sum + Number(item.ai_enabled_total || 0), 0), '允许进入 AI')}
        ${metric('AI 禁用总数', rows.reduce((sum, item) => sum + Number(item.ai_blocked_total || 0), 0), '仅档案保留')}
      </div>
      <div class="actions-row"><button class="small-btn switch-view" data-view="missing-items">查看缺失项</button><button class="small-btn switch-view" data-view="ai-governance">打开 AI 治理</button></div>
      <div class="detail-layout top-gap">
        <section class="panel compact-panel">
          <div class="table-wrap"><table><thead><tr><th>部门</th><th>必传项</th><th>已归档</th><th>缺失</th><th>AI 可用</th><th>AI 禁用</th><th>覆盖率</th><th>操作</th></tr></thead><tbody>
            ${rows.map((item) => `<tr><td>${esc(item.scope_name)}</td><td>${item.required_total}</td><td>${item.filed_total}</td><td>${item.missing_total}</td><td>${item.ai_enabled_total}</td><td>${item.ai_blocked_total}</td><td>${item.coverage_rate}%</td><td><button class="small-btn" onclick="openCoverageScope('${item.scope_id}')">查看明细</button></td></tr>`).join('')}
          </tbody></table></div>
        </section>
        <aside class="aside-stack">
          <section class="panel compact-panel">
            <div class="section-title"><h2>部门明细</h2><span class="subtle">${esc(detail?.scope_name || '未选择部门')}</span></div>
            ${detail ? `<div class="grid cols-2 summary-strip">
              ${metric('必传项', detail.required_total || 0, '')}
              ${metric('已归档', detail.filed_total || 0, '')}
              ${metric('缺失', detail.missing_total || 0, '')}
              ${metric('覆盖率', `${detail.coverage_rate || 0}%`, '')}
            </div>
            <div class="table-wrap"><table><thead><tr><th>目录项</th><th>匹配文档</th><th>归档</th><th>AI</th></tr></thead><tbody>
              ${(detail.items || []).map((item) => `<tr><td><strong>${esc(item.document_name_rule || '-')}</strong><br><small class="subtle">${esc(item.category || '-')} / ${esc(item.subcategory || '-')}</small></td><td>${(item.matched_documents || []).length ? (item.matched_documents || []).map((doc) => `<div><button class="small-btn" onclick="openDetail('${doc.id}')">${esc(doc.title)}</button><small class="subtle">${esc(syncStatusLabel(doc.knowledge_sync_status || 'missing'))} · dataset:${esc(doc.dataset_mapping?.dataset_name || doc.knowledge_dataset_key || '-')}</small></div>`).join('') : '<span class="subtle">暂无</span>'}</td><td><span class="status ${item.missing ? 'failed' : 'completed'}">${item.missing ? '缺失' : '已覆盖'}</span></td><td><span class="status ${item.ai_ready ? 'completed' : 'failed'}">${item.ai_ready ? '可用' : '阻断'}</span><br><small class="subtle">${esc(item.ai_block_reason || '-')}</small></td></tr>`).join('') || '<tr><td colspan="4" class="subtle">暂无明细。</td></tr>'}
            </tbody></table></div>` : '<p class="subtle">选择一个部门查看目录项与匹配文档明细。</p>'}
          </section>
        </aside>
      </div>
    </section>`;
}

async function archiveCatalogs() {
  const scopeQuery = state.selectedCatalogScopeId ? `?scope_id=${encodeURIComponent(state.selectedCatalogScopeId)}` : '';
  const [tree, catalogs, items] = await Promise.all([
    api('/archive/scopes'),
    api(`/archive/catalogs${scopeQuery}`),
    api(`/archive/catalog-items${scopeQuery}`)
  ]);
  const scopeOptions = state.ref.departments || [];
  const allScopeIds = collectOrgNodeIds(tree);
  if (state.selectedCatalogScopeId && !allScopeIds.includes(state.selectedCatalogScopeId)) {
    state.selectedCatalogScopeId = '';
  }
  if (!state.selectedCatalogScopeId && !('selectedCatalogScopeInitialized' in state)) {
    state.selectedCatalogScopeId = scopeOptions[0]?.id || allScopeIds[0] || '';
    state.selectedCatalogScopeInitialized = true;
  }
  const selectedScope = scopeOptions.find((item) => item.id === state.selectedCatalogScopeId) || null;
  const filteredItems = state.selectedCatalogScopeId ? items.filter((item) => item.scope_id === state.selectedCatalogScopeId) : items;
  const draft = state.catalogDraft;
  $('content').innerHTML = `
    <section class="panel">
      <div class="section-title"><h2>部门档案目录</h2><span class="subtle">维护各部门应归档的目录项与默认 AI 策略</span></div>
      <div class="catalog-layout catalog-layout-wide">
        <section class="panel compact-panel tree-panel">
          <div class="section-title"><h2>组织范围</h2><span class="subtle">点击左侧部门筛选目录项</span></div>
          <div class="actions-row compact-actions"><button id="catalogClearScope" class="small-btn">查看全部</button></div>
          <div class="tree-list">${renderCatalogTree(tree)}</div>
        </section>
        <section class="panel compact-panel">
          <div class="section-title"><h2>目录模板与新增目录项</h2><span class="subtle">当前归属：${esc(selectedScope?.name || '未选择部门')}</span></div>
          <div class="list">${catalogs.map((item) => `<div class="list-item"><div><strong>${esc(item.name)}</strong><small>${esc(item.description || '-')} · 项数 ${item.item_count || 0} · 状态 ${esc(item.status || '-')}</small></div><div class="actions-row compact-actions"><button class="small-btn" onclick="editArchiveCatalog('${item.id}')">编辑模板</button><button class="small-btn warn" onclick="disableArchiveCatalog('${item.id}')">停用模板</button></div></div>`).join('') || '<p class="subtle">当前范围暂无目录模板。</p>'}</div>
          <div class="form-grid top-gap">
            <label>模板名称<input id="catalogTemplateName" placeholder="例如：财务归档模板"></label>
            <label>模板说明<input id="catalogTemplateDesc" placeholder="例如：财务制度与审批归档"></label>
            <label>部门<select id="catalogScopeId">${optionList(scopeOptions, state.selectedCatalogScopeId || scopeOptions[0]?.id || '', false)}</select></label>
            <label>部门名称<input id="catalogScopeName" value="${esc(selectedScope?.name || scopeOptions[0]?.name || '')}"></label>
            <label>模板状态<select id="catalogTemplateStatus">${optionList(['active', 'disabled'], 'active', false)}</select></label>
            <label>模板排序<input id="catalogTemplateSortOrder" type="number" value="0"></label>
            <label>所属模板<select id="catalogTemplateId">${optionList(catalogs.filter((item) => item.status !== 'disabled').map((item) => ({ id: item.id, name: item.name })), '', false)}</select></label>
            <label>分类<input id="catalogCategory" value="制度"></label>
            <label>子分类<input id="catalogSubcategory" value=""></label>
            <label class="wide">目录规则<input id="catalogRule" placeholder="例如：年度财务制度文件"></label>
            <label class="wide">说明<input id="catalogDescription" placeholder="例如：财务部制度与流程归档"></label>
            <label>是否必传<select id="catalogRequired">${optionList([{id:'true',name:'是'},{id:'false',name:'否'}], 'true', false)}</select></label>
            <label>默认 AI 可用<select id="catalogAiEnabled">${optionList([{id:'true',name:'是'},{id:'false',name:'否'}], 'false', false)}</select></label>
            <label>默认 AI 用途<select id="catalogAiScope">${optionList(['archive_only','ai_search','ai_answer'], 'archive_only', false)}</select></label>
          </div>
          <div class="actions-row"><button id="createCatalogTemplate" class="small-btn">新增目录模板</button><button id="createCatalogItem" class="accent">新增目录项</button></div>
        </section>
        <section class="panel compact-panel">
          <div class="section-title"><h2>编辑目录项</h2><span class="subtle">${esc(draft?.scope_name || '请选择一项')}</span></div>
          ${draft ? `<div class="form-grid">
            <label>分类<input id="editCatalogCategory" value="${esc(draft.category || '')}"></label>
            <label>子分类<input id="editCatalogSubcategory" value="${esc(draft.subcategory || '')}"></label>
            <label class="wide">目录规则<input id="editCatalogRule" value="${esc(draft.document_name_rule || '')}"></label>
            <label class="wide">说明<textarea id="editCatalogDescription">${esc(draft.document_description || '')}</textarea></label>
            <label>是否必传<select id="editCatalogRequired">${optionList([{id:'true',name:'是'},{id:'false',name:'否'}], String(!!draft.required), false)}</select></label>
            <label>允许 AI<select id="editCatalogAiAllowed">${optionList([{id:'true',name:'是'},{id:'false',name:'否'}], String(draft.ai_allowed !== false), false)}</select></label>
            <label>默认 AI<select id="editCatalogAiEnabled">${optionList([{id:'true',name:'是'},{id:'false',name:'否'}], String(!!draft.default_ai_enabled), false)}</select></label>
            <label>默认 AI 用途<select id="editCatalogAiScope">${optionList(['archive_only','ai_search','ai_answer'], draft.default_ai_usage_type || 'archive_only', false)}</select></label>
            <label>归档周期<input id="editCatalogArchivePeriod" value="${esc(draft.archive_period || '')}"></label>
            <label>保管期限<input id="editCatalogRetentionPolicy" value="${esc(draft.retention_policy || '')}"></label>
            <label>默认可见性<input id="editCatalogVisibility" value="${esc(draft.default_visibility || '')}"></label>
            <label>责任角色<input id="editCatalogOwnerRole" value="${esc(draft.owner_role || '')}"></label>
            <label>匹配规则<input id="editCatalogMatchingRule" value="${esc(draft.matching_rule || '')}"></label>
            <label>排序<input id="editCatalogSortOrder" type="number" value="${esc(draft.sort_order || 0)}"></label>
            <label>状态<input id="editCatalogStatus" value="${esc(draft.status || '')}"></label>
          </div><div class="actions-row"><button class="accent" onclick="saveCatalogItem('${draft.id}')">保存编辑</button><button class="small-btn" onclick="clearCatalogDraft()">取消</button></div>` : '<p class="subtle">点击列表中的“编辑”后可在这里修改 richer 字段。</p>'}
        </section>
      </div>
      <div class="section-title"><h2>目录项列表</h2><span class="subtle">${state.selectedCatalogScopeId ? `${esc(selectedScope?.name || '')} · ` : ''}共 ${filteredItems.length} 项</span></div>
      <div class="table-wrap"><table><thead><tr><th>部门</th><th>分类</th><th>规则</th><th>必传</th><th>默认 AI</th><th>扩展字段</th><th>操作</th></tr></thead><tbody>
        ${filteredItems.map((item) => `<tr><td>${esc(item.scope_name || item.scope_id || '-')}</td><td>${esc(item.category || '-')} / ${esc(item.subcategory || '-')}</td><td><strong>${esc(item.document_name_rule || '-')}</strong><br><small class="subtle">${esc(item.document_description || '-')}</small></td><td>${esc(boolLabel(item.required))}</td><td>${esc(boolLabel(item.default_ai_enabled))} · ${esc(aiScopeLabel(item.default_ai_usage_type))}</td><td><small class="subtle">周期:${esc(item.archive_period || '-')} · 保管:${esc(item.retention_policy || '-')} · 角色:${esc(item.owner_role || '-')} · 状态:${esc(item.status || '-')}</small></td><td><button class="small-btn" onclick="editCatalogItem('${item.id}')">编辑</button></td></tr>`).join('') || '<tr><td colspan="7" class="subtle">当前部门暂无目录项。</td></tr>'}
      </tbody></table></div>
    </section>`;
  $('catalogScopeId').onchange = () => {
    const match = scopeOptions.find((item) => item.id === $('catalogScopeId').value);
    state.selectedCatalogScopeId = $('catalogScopeId').value;
    if (match) $('catalogScopeName').value = match.name;
    archiveCatalogs();
  };
  $('createCatalogTemplate').onclick = async () => {
    const scopeId = $('catalogScopeId').value;
    const scopeName = $('catalogScopeName').value;
    const name = $('catalogTemplateName').value.trim();
    if (!name) return toast('请先填写模板名称');
    await api('/archive/catalogs', {
      method: 'POST',
      body: JSON.stringify({
        scope_id: scopeId,
        scope_name: scopeName,
        name,
        description: $('catalogTemplateDesc').value.trim(),
        status: $('catalogTemplateStatus').value,
        sort_order: Number($('catalogTemplateSortOrder').value || 0)
      })
    });
    toast('目录模板已新增');
    await archiveCatalogs();
  };
  $('catalogClearScope').onclick = async () => {
    state.selectedCatalogScopeId = '';
    await archiveCatalogs();
  };
  $('content').querySelectorAll('[data-scope-id]').forEach((node) => {
    node.addEventListener('click', async () => {
      state.selectedCatalogScopeId = node.dataset.scopeId || '';
      await archiveCatalogs();
    });
  });
  $('createCatalogItem').onclick = async () => {
    await api('/archive/catalog-items', {
      method: 'POST',
      body: JSON.stringify({
        catalog_id: $('catalogTemplateId').value,
        scope_id: $('catalogScopeId').value,
        scope_name: $('catalogScopeName').value,
        category: $('catalogCategory').value,
        subcategory: $('catalogSubcategory').value,
        document_name_rule: $('catalogRule').value,
        document_description: $('catalogDescription').value,
        required: $('catalogRequired').value === 'true',
        default_ai_enabled: $('catalogAiEnabled').value === 'true',
        default_ai_usage_type: $('catalogAiScope').value
      })
    });
    state.selectedCatalogScopeId = $('catalogScopeId').value;
    toast('目录项已新增');
    await archiveCatalogs();
  };
}

window.editCatalogItem = async (id) => {
  const items = await api('/archive/catalog-items');
  const item = items.find((row) => row.id === id);
  if (!item) return toast('目录项不存在');
  state.catalogDraft = item;
  await archiveCatalogs();
};

async function missingItems() {
  const params = new URLSearchParams();
  if (state.missingItemsFilters.filing_year) params.set('filing_year', state.missingItemsFilters.filing_year);
  if (state.missingItemsFilters.filing_period) params.set('filing_period', state.missingItemsFilters.filing_period);
  const [summary, data] = await Promise.all([
    api(`/archive/missing-required?${params.toString()}`),
    api(`/archive/missing-items?${params.toString()}`)
  ]);
  const grouped = Object.values((summary.items || []).reduce((acc, item) => {
    const key = item.scope_id || 'unknown';
    if (!acc[key]) {
      acc[key] = {
        scope_id: item.scope_id || '',
        scope_name: item.scope_name || '未分组',
        count: 0,
        owners: new Set(),
        items: []
      };
    }
    acc[key].count += 1;
    if (item.archive_owner_id) acc[key].owners.add(userNameById(item.archive_owner_id));
    acc[key].items.push(item);
    return acc;
  }, {})).map((group) => ({
    ...group,
    owners: [...group.owners].filter(Boolean)
  }));
  const selectedScopeId = state.selectedMissingScopeId && grouped.some((item) => item.scope_id === state.selectedMissingScopeId)
    ? state.selectedMissingScopeId
    : grouped[0]?.scope_id || '';
  state.selectedMissingScopeId = selectedScopeId;
  const selectedGroup = grouped.find((item) => item.scope_id === selectedScopeId) || null;
  const detailItems = selectedGroup?.items || data.items || [];
  $('content').innerHTML = `
    <section class="panel">
      <div class="section-title"><h2>缺失文档提醒</h2><span class="subtle">共 ${data.total || 0} 个缺失必传项</span></div>
      <div class="grid cols-4">
        ${metric('缺失部门', grouped.length, '待补齐范围')}
        ${metric('缺失项数', data.total || 0, '当前筛选结果')}
        ${metric('当前部门', selectedGroup?.scope_name || '-', '右侧查看明细')}
        ${metric('责任人', selectedGroup?.owners?.join('、') || '-', '按部门汇总')}
      </div>
      <div class="toolbar">
        <label class="filter-field"><span class="subtle">归档年度</span><input id="missingYear" placeholder="归档年度，例如 2026" value="${esc(state.missingItemsFilters.filing_year || '')}" /></label>
        <label class="filter-field"><span class="subtle">归档周期</span><select id="missingPeriod">${optionList(['年度', '月度', '季度'], state.missingItemsFilters.filing_period || '')}</select></label>
      </div>
      <div class="actions-row"><button id="applyMissingFilters" class="small-btn">应用筛选</button><button id="clearMissingFilters" class="small-btn">清空筛选</button><button id="exportMissingItems" class="small-btn">导出缺失清单</button><button class="small-btn switch-view" data-view="archive-coverage">返回覆盖看板</button><button class="accent switch-view" data-view="upload">上传档案文档</button></div>
      <div class="detail-layout top-gap">
        <section class="panel compact-panel">
          <div class="section-title"><h2>部门汇总</h2><span class="subtle">按部门查看缺失数与责任人</span></div>
          <div class="table-wrap"><table><thead><tr><th>部门</th><th>缺失项</th><th>责任人</th><th>操作</th></tr></thead><tbody>
            ${grouped.map((item) => `<tr><td>${esc(item.scope_name || '-')}</td><td>${esc(String(item.count || 0))}</td><td>${esc(item.owners.join('、') || '-')}</td><td><button class="small-btn" onclick="selectMissingScope('${item.scope_id}')">${state.selectedMissingScopeId === item.scope_id ? '当前部门' : '查看明细'}</button></td></tr>`).join('') || '<tr><td colspan="4" class="subtle">暂无缺失汇总。</td></tr>'}
          </tbody></table></div>
        </section>
        <aside class="aside-stack">
          <section class="panel compact-panel">
            <div class="section-title"><h2>缺失明细</h2><span class="subtle">${esc(selectedGroup?.scope_name || '未选择部门')}</span></div>
            ${detailItems.length ? list(detailItems, (item) => `<strong>${esc(item.document_name_rule || '-')}</strong><small>${esc(item.category || '-')} / ${esc(item.subcategory || '-')} · 年度:${esc(item.filing_year || '-')} · 周期:${esc(item.filing_period || '-')}</small><p>档案责任人：${esc(userNameById(item.archive_owner_id))}；复核责任人：${esc(userNameById(item.review_owner_id))}；责任角色：${esc(item.owner_role || '-')}</p><div class="actions-row"><button class="small-btn" onclick="openCoverageScope('${item.scope_id}')">查看覆盖明细</button><button class="small-btn" onclick="openUploadForMissingItem('${esc(item.scope_id)}', '${esc(item.scope_name || '')}', '${esc(item.category || '')}', '${esc(item.subcategory || '')}', '${esc(item.document_name_rule || '')}', '${esc(item.filing_year || '')}', '${esc(item.filing_period || '')}', '${esc(item.archive_owner_id || '')}', '${esc(item.review_owner_id || '')}')">去上传</button></div>`) : '<p class="subtle">当前筛选下暂无缺失明细。</p>'}
          </section>
        </aside>
      </div>
    </section>`;
  $('applyMissingFilters').onclick = async () => {
    state.missingItemsFilters = { filing_year: $('missingYear').value.trim(), filing_period: $('missingPeriod').value };
    await missingItems();
  };
  $('clearMissingFilters').onclick = async () => {
    state.missingItemsFilters = { filing_year: '', filing_period: '' };
    state.selectedMissingScopeId = '';
    await missingItems();
  };
  $('exportMissingItems').onclick = async () => {
    const query = new URLSearchParams();
    if (state.missingItemsFilters.filing_year) query.set('filing_year', state.missingItemsFilters.filing_year);
    if (state.missingItemsFilters.filing_period) query.set('filing_period', state.missingItemsFilters.filing_period);
    const content = await api(`/archive/missing-items/export?${query.toString()}`);
    downloadText('archive-missing-items.csv', content || '');
    toast('缺失清单已导出');
  };
}

async function aiGovernance() {
  const query = state.aiReviewStatusFilter ? `?status=${encodeURIComponent(state.aiReviewStatusFilter)}` : '';
  const [docs, candidates, reviewRecords] = await Promise.all([
    api('/ai-governance/documents'),
    api('/ai-governance/sync-candidates'),
    api(`/ai-governance/review-records${query}`)
  ]);
  const allDocs = docs.documents || [];
  const candidateDocs = candidates.documents || [];
  const syncedDocs = allDocs.filter((d) => ['synced', 'done', 'available'].includes(String(d.knowledge_sync_status || d.dify_sync_status || '').toLowerCase()));
  const blockedDocs = allDocs.filter((d) => !d.ai_gate_allowed || d.ai_review_status === 'rejected' || !!d.ai_gate_block_reason);
  $('content').innerHTML = `
    <section class="panel">
      <div class="section-title"><h2>AI 治理</h2><span class="subtle">候选同步 ${candidateDocs.length} 个，已同步 ${syncedDocs.length} 个，被阻断 ${blockedDocs.length} 个</span></div>
      <div class="grid cols-4">
        ${metric('候选同步', candidateDocs.length, '待提交到知识库')}
        ${metric('已同步', syncedDocs.length, '已进入知识库')}
        ${metric('被阻断', blockedDocs.length, '需人工处理')}
        ${metric('审核记录', reviewRecords.length || 0, '最近治理动作')}
      </div>
      <div class="actions-row"><button id="aiGovBatchEnable" class="small-btn">批量启用 AI</button><button id="aiGovBatchDisable" class="small-btn">批量禁用 AI</button><button id="aiGovBatchSync" class="accent">批量同步候选文档</button><button class="small-btn switch-view" data-view="archive-library">查看档案库</button></div>
      <div class="section-title"><h2>候选同步清单</h2><span class="subtle">满足准入条件但尚未完成同步</span></div>
      <div class="table-wrap"><table><thead><tr><th></th><th>文档</th><th>归档</th><th>AI 用途</th><th>同步状态</th><th>准入结果</th></tr></thead><tbody>
        ${candidateDocs.map((d) => `<tr><td><input type="checkbox" onchange="toggleSelect('${d.id}', this.checked)"></td><td><strong>${esc(d.title)}</strong><br><small class="subtle">${esc(d.document_code || '-')} · ${esc(d.department_name || '-')}</small></td><td>${esc(archiveStatusLabel(d.filing_status))}</td><td>${esc(aiScopeLabel(d.ai_usage_scope))}</td><td>${esc(syncStatusLabel(d.knowledge_sync_status || d.dify_sync_status))}</td><td><span class="status ${aiGateStatusClass(d)}">${esc(aiGateLabel(d))}</span><br><small class="subtle">${esc(d.ai_gate_block_reason || '符合入库条件')}</small></td></tr>`).join('') || '<tr><td colspan="6" class="subtle">暂无候选文档。</td></tr>'}
      </tbody></table></div>
      <div class="section-title"><h2>已同步文档</h2><span class="subtle">已进入知识库，可继续查看状态与详情</span></div>
      <div class="table-wrap"><table><thead><tr><th>文档</th><th>部门</th><th>AI 用途</th><th>同步状态</th><th>映射 dataset</th><th>操作</th></tr></thead><tbody>
        ${syncedDocs.map((d) => `<tr><td><strong>${esc(d.title)}</strong><br><small class="subtle">${esc(d.document_code || '-')}</small></td><td>${esc(d.department_name || '-')}</td><td>${esc(aiScopeLabel(d.ai_usage_scope))}</td><td>${esc(syncStatusLabel(d.knowledge_sync_status || d.dify_sync_status))}</td><td>${esc(d.dataset_mapping?.dataset_name || d.knowledge_dataset_key || '-')}</td><td><button class="small-btn" onclick="openDetail('${d.id}')">查看详情</button></td></tr>`).join('') || '<tr><td colspan="6" class="subtle">暂无已同步文档。</td></tr>'}
      </tbody></table></div>
      <div class="section-title"><h2>被阻断文档</h2><span class="subtle">集中查看阻断原因、待复核原因和处理动作</span></div>
      <div class="table-wrap"><table><thead><tr><th></th><th>文档</th><th>AI 开关</th><th>用途</th><th>同步状态</th><th>准入结果</th><th>人工备注</th><th>操作</th></tr></thead><tbody>
        ${blockedDocs.map((d) => `<tr><td><input type="checkbox" onchange="toggleSelect('${d.id}', this.checked)"></td><td><strong>${esc(d.title)}</strong><br><small class="subtle">${esc(d.department_name || '-')} · ${esc(d.confidentiality_level || '-')} · 审核:${esc(reviewStatusLabel(d.ai_review_status || 'pending'))}</small><br><small class="subtle">待复核原因：${esc(d.review_pending_reason || '-')}</small></td><td>${esc(boolLabel(d.ai_enabled))}<br><small class="subtle">${esc(d.ai_review_status === 'pending' ? '需确认/待审批' : '已确认')}</small></td><td>${esc(aiScopeLabel(d.ai_usage_scope))}</td><td>${esc(syncStatusLabel(d.knowledge_sync_status || d.dify_sync_status))}</td><td><span class="status ${aiGateStatusClass(d)}">${esc(aiGateLabel(d))}</span><br><small class="subtle">系统阻断：${esc(d.ai_gate_block_reason || '符合入库条件')}</small><br><small class="subtle">映射：${esc(d.dataset_mapping?.dataset_name || d.knowledge_dataset_key || '-')}</small></td><td><label>审核备注<textarea id="aiReviewNote-${d.id}" placeholder="例如：已完成人工复核">${esc(d.ai_review_note || '')}</textarea></label><label>人工阻断备注<textarea id="aiBlockReason-${d.id}" placeholder="例如：法务待确认，暂不开放 AI">${esc(d.ai_block_reason || '')}</textarea></label><small class="subtle">最近复核：${esc(fmt(d.last_ai_reviewed_at || d.last_reviewed_at || ''))}</small></td><td><button class="small-btn" onclick="toggleAiDoc('${d.id}', ${d.ai_enabled ? 'false' : 'true'})">${d.ai_enabled ? '禁用 AI' : '启用 AI'}</button><button class="small-btn" onclick="saveAiNotes('${d.id}')">保存备注</button><button class="small-btn" onclick="reviewAiDoc('${d.id}', 'approved')">审核通过</button><button class="small-btn" onclick="reviewAiDoc('${d.id}', 'rejected')">审核退回</button><button class="small-btn" onclick="openDetail('${d.id}')">查看详情</button></td></tr>`).join('') || '<tr><td colspan="8" class="subtle">暂无被阻断文档。</td></tr>'}
      </tbody></table></div>
      <div class="section-title"><h2>最近审核记录</h2><span class="subtle">共 ${reviewRecords.length || 0} 条</span></div>
      <div class="actions-row"><label>审核状态<select id="aiReviewStatusFilter">${optionList([{id:'approved',name:'已通过'},{id:'rejected',name:'已退回'},{id:'pending',name:'待审核'}], state.aiReviewStatusFilter || '')}</select></label><button id="applyAiReviewFilter" class="small-btn">筛选记录</button></div>
      <div class="table-wrap"><table><thead><tr><th>时间</th><th>文档</th><th>结果</th><th>审核人</th><th>备注</th><th>阻断原因</th></tr></thead><tbody>
        ${(reviewRecords || []).map((item) => `<tr><td>${esc(fmt(item.created_at || ''))}</td><td>${esc(item.document_title || '-')}</td><td><span class="status ${item.status === 'approved' ? 'completed' : 'failed'}">${esc(reviewStatusLabel(item.status))}</span></td><td>${esc(item.actor_name || item.actor || '-')}</td><td>${esc(item.note || '-')}</td><td>${esc(item.block_reason || '-')}</td></tr>`).join('') || '<tr><td colspan="6" class="subtle">暂无审核记录。</td></tr>'}
      </tbody></table></div>
    </section>`;
  $('applyAiReviewFilter').onclick = async () => {
    state.aiReviewStatusFilter = $('aiReviewStatusFilter').value;
    await aiGovernance();
  };
  $('aiGovBatchEnable').onclick = async () => {
    const ids = [...state.selected];
    if (!ids.length) return toast('请先选择文档');
    await api('/ai-governance/documents/batch-policy?ai_enabled=true', { method: 'POST', body: JSON.stringify({ ids }) });
    state.selected.clear();
    toast('已批量启用 AI');
    await aiGovernance();
  };
  $('aiGovBatchDisable').onclick = async () => {
    const ids = [...state.selected];
    if (!ids.length) return toast('请先选择文档');
    await api('/ai-governance/documents/batch-policy?ai_enabled=false', { method: 'POST', body: JSON.stringify({ ids }) });
    state.selected.clear();
    toast('已批量禁用 AI');
    await aiGovernance();
  };
  $('aiGovBatchSync').onclick = async () => {
    const ids = [...state.selected];
    if (!ids.length) return toast('请先选择候选文档');
    await api('/ai-governance/sync-candidates/batch-sync', { method: 'POST', body: JSON.stringify({ ids }) });
    state.selected.clear();
    toast('候选文档已提交同步');
    await aiGovernance();
  };
}

window.toggleAiDoc = async (id, enabled) => {
  await api(`/ai-governance/documents/${id}`, { method: 'PATCH', body: JSON.stringify({ ai_enabled: enabled }) });
  toast(enabled ? '已启用 AI' : '已禁用 AI');
  await aiGovernance();
};

window.saveAiNotes = async (id) => {
  await api(`/ai-governance/documents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ai_review_note: $(`aiReviewNote-${id}`).value,
      ai_block_reason: $(`aiBlockReason-${id}`).value
    })
  });
  toast('AI 治理备注已保存');
  await aiGovernance();
};

window.reviewAiDoc = async (id, status) => {
  await api(`/ai-governance/documents/${id}/review`, {
    method: 'POST',
    body: JSON.stringify({
      status,
      note: $(`aiReviewNote-${id}`).value,
      block_reason: $(`aiBlockReason-${id}`).value
    })
  });
  toast(status === 'approved' ? 'AI 审核已通过' : 'AI 审核已退回');
  await aiGovernance();
};

window.selectMissingScope = async (scopeId) => {
  state.selectedMissingScopeId = scopeId;
  await missingItems();
};

window.openUploadForMissingItem = async (scopeId, scopeName, category, subcategory, rule, filingYear, filingPeriod, archiveOwnerId, reviewOwnerId) => {
  state.uploadPrefill = {
    org_unit_id: scopeId,
    department_id: scopeId,
    org_path: scopeName ? `/${scopeName}` : '',
    archive_category: category || '制度',
    document_type: subcategory || '通用文档',
    required_rule_source: rule || '',
    title: rule || '',
    filing_year: filingYear || '2026',
    filing_period: filingPeriod || '年度',
    is_required: true,
    archive_owner_id: archiveOwnerId || '',
    review_owner_id: reviewOwnerId || '',
    ai_enabled: false,
    visibility: 'department'
  };
  await switchView('upload');
};

window.openCoverageScope = async (scopeId) => {
  state.selectedCoverageScopeId = scopeId;
  state.selectedCoverageDetail = await api(`/archive/coverage/${scopeId}`);
  state.view = 'archive-coverage';
  await archiveCoverage();
};

window.clearCatalogDraft = async () => {
  state.catalogDraft = null;
  await archiveCatalogs();
};

window.saveCatalogItem = async (id) => {
  await api(`/archive/catalog-items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      category: $('editCatalogCategory').value,
      subcategory: $('editCatalogSubcategory').value,
      document_name_rule: $('editCatalogRule').value,
      document_description: $('editCatalogDescription').value,
      required: $('editCatalogRequired').value === 'true',
      ai_allowed: $('editCatalogAiAllowed').value === 'true',
      default_ai_enabled: $('editCatalogAiEnabled').value === 'true',
      default_ai_usage_type: $('editCatalogAiScope').value,
      archive_period: $('editCatalogArchivePeriod').value,
      retention_policy: $('editCatalogRetentionPolicy').value,
      default_visibility: $('editCatalogVisibility').value,
      owner_role: $('editCatalogOwnerRole').value,
      matching_rule: $('editCatalogMatchingRule').value,
      sort_order: Number($('editCatalogSortOrder').value || 0),
      status: $('editCatalogStatus').value
    })
  });
  state.catalogDraft = null;
  toast('目录项已更新');
  await archiveCatalogs();
};

window.editArchiveCatalog = async (id) => {
  const catalogs = await api(`/archive/catalogs${state.selectedCatalogScopeId ? `?scope_id=${encodeURIComponent(state.selectedCatalogScopeId)}` : ''}`);
  const item = catalogs.find((row) => row.id === id);
  if (!item) return toast('目录模板不存在');
  const name = window.prompt('模板名称', item.name || '');
  if (name === null) return;
  const descriptionInput = window.prompt('模板说明', item.description || '');
  const description = descriptionInput ?? (item.description || '');
  const statusInput = window.prompt('模板状态（active / disabled）', item.status || 'active');
  const status = statusInput ?? (item.status || 'active');
  const sortOrderInput = window.prompt('模板排序', String(item.sort_order ?? 0));
  const sortOrder = Number(sortOrderInput || item.sort_order || 0);
  await api(`/archive/catalogs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name, description, status, sort_order: sortOrder })
  });
  toast('目录模板已更新');
  await archiveCatalogs();
};

window.disableArchiveCatalog = async (id) => {
  await api(`/archive/catalogs/${id}`, { method: 'DELETE' });
  toast('目录模板已停用');
  await archiveCatalogs();
};

window.saveDatasetMapping = async (id) => {
  const mappings = await api('/knowledge/datasets/mapping');
  const next = (mappings.mappings || []).map((item) => item.id === id ? {
    ...item,
    archive_category: $(`datasetArchiveCategory-${id}`).value,
    document_type: $(`datasetDocumentType-${id}`).value,
    ai_usage_scope: $(`datasetAiScope-${id}`).value,
    dataset_name: $(`datasetName-${id}`).value,
    priority: Number($(`datasetPriority-${id}`).value || 0),
    enabled: $(`datasetEnabled-${id}`).value === 'true'
  } : item);
  await api('/knowledge/datasets/mapping', {
    method: 'PATCH',
    body: JSON.stringify({ mappings: next })
  });
  toast('Dataset mapping 已保存');
  await settings();
};

window.toggleDatasetMapping = async (id) => {
  const mappings = await api('/knowledge/datasets/mapping');
  const next = (mappings.mappings || []).map((item) => item.id === id ? { ...item, enabled: !(item.enabled !== false) } : item);
  await api('/knowledge/datasets/mapping', {
    method: 'PATCH',
    body: JSON.stringify({ mappings: next })
  });
  toast('Dataset mapping 状态已更新');
  await settings();
};

window.deleteDatasetMapping = async (id) => {
  const mappings = await api('/knowledge/datasets/mapping');
  const next = (mappings.mappings || []).filter((item) => item.id !== id);
  await api('/knowledge/datasets/mapping', {
    method: 'PATCH',
    body: JSON.stringify({ mappings: next })
  });
  toast('Dataset mapping 已删除');
  await settings();
};

async function indexStatus() {
  const data = await api('/index/status');
  $('content').innerHTML = `<div class="grid cols-4">${Object.entries(data.summary).map(([k, v]) => metric(k, v)).join('')}</div><div class="section-title"><h2>索引任务</h2><span class="subtle">重新索引会生成本地 chunk 统计，LLM embedding 后续接入</span></div><section class="panel">${list(data.jobs, (j) => `<strong>${esc(j.document_title)}</strong><small><span class="status ${j.status}">${j.status}</span> · ${j.chunk_count} chunks · ${esc(j.message)} · ${fmt(j.created_at)}</small>`)}</section>`;
}

async function permissions() {
  const data = await api('/documents');
  state.documents = data.documents;
  state.filters = data.filters;
  if (!state.selectedPermissionDocumentId && data.documents[0]?.id) state.selectedPermissionDocumentId = data.documents[0].id;
  const selected = state.selectedPermissionDocumentId
    ? await api(`/documents/${state.selectedPermissionDocumentId}`)
    : null;
  if (selected && (!state.permissionDraft || state.permissionDraft.documentId !== selected.id)) {
    state.permissionDraft = {
      documentId: selected.id,
      visibility: selected.visibility || 'department',
      user_ids: [...(selected.permissions?.user_ids || [])],
      role_ids: [...(selected.permissions?.role_ids || [])],
      department_ids: [...(selected.permissions?.department_ids || [])]
    };
  }
  const perms = state.permissionDraft || { user_ids: [], role_ids: [], department_ids: [], visibility: selected?.visibility || 'department' };
  const checkboxList = (items, selectedIds, prefix, labeler) => {
    const keyword = String(state.permissionSearch[prefix] || '').trim().toLowerCase();
    const visibleItems = keyword
      ? (items || []).filter((item) => labeler(item).toLowerCase().includes(keyword) || String(item.id || '').toLowerCase().includes(keyword))
      : (items || []);
    return `<div class="picker-tools"><input data-perm-search="${prefix}" value="${esc(state.permissionSearch[prefix] || '')}" placeholder="搜索${prefix === 'users' ? '用户' : prefix === 'roles' ? '角色' : '部门'}"><button type="button" class="small-btn" data-perm-toggle="${prefix}" data-perm-mode="visible-on">全选当前</button><button type="button" class="small-btn" data-perm-toggle="${prefix}" data-perm-mode="visible-off">取消当前</button></div><div class="picker-grid">${visibleItems.map((item) => `<label class="checkbox-row"><input type="checkbox" data-perm-group="${prefix}" value="${esc(item.id)}" ${selectedIds.includes(item.id) ? 'checked' : ''}> <span>${esc(labeler(item))}</span></label>`).join('') || '<p class="subtle">暂无可选项。</p>'}</div>`;
  };
  const selectedValues = (group) => Array.from(document.querySelectorAll(`[data-perm-group="${group}"]:checked`)).map((node) => node.value);
  $('content').innerHTML = `
    <section class="panel">
      <div class="section-title"><h2>文档权限矩阵</h2><span class="subtle">当前支持逐文档权限编辑，保存后立即写入现有权限模型</span></div>
      <div class="detail-layout">
        <section class="panel compact-panel">
          <div class="table-wrap"><table><thead><tr><th>文档</th><th>上传人</th><th>可见级别</th><th>操作</th></tr></thead><tbody>
            ${(data.documents || []).map((doc) => `<tr><td><strong>${esc(doc.title)}</strong><br><small class="subtle">${esc(doc.file_name || '-')}</small></td><td>${esc(doc.owner_name || '-')}<br><small class="subtle">${esc(doc.department_name || '-')}</small></td><td>${esc(doc.visibility || '-')}</td><td><button class="small-btn" onclick="selectPermissionDocument('${doc.id}')">${state.selectedPermissionDocumentId === doc.id ? '当前文档' : '编辑权限'}</button></td></tr>`).join('') || '<tr><td colspan="4" class="subtle">暂无文档。</td></tr>'}
          </tbody></table></div>
        </section>
        <aside class="aside-stack">
          <section class="panel compact-panel">
            <div class="section-title"><h2>权限编辑</h2><span class="subtle">${esc(selected?.title || '未选择文档')}</span></div>
            ${selected ? `
              <div class="form-grid">
                <label>可见级别<select id="permVisibility">${optionList(state.filters.visibilities || ['public', 'department', 'role', 'private', 'admin'], perms.visibility || 'department', false)}</select></label>
                <div class="wide"><strong>用户白名单</strong>${checkboxList(state.ref.users || [], perms.user_ids || [], 'users', (item) => `${item.name || item.username || item.id} (${item.id})`)}</div>
                <div class="wide"><strong>角色白名单</strong>${checkboxList(state.ref.roles || [], perms.role_ids || [], 'roles', (item) => `${item.name || item.id} (${item.id})`)}</div>
                <div class="wide"><strong>部门白名单</strong>${checkboxList(state.ref.departments || [], perms.department_ids || [], 'departments', (item) => `${item.name || item.id} (${item.id})`)}</div>
              </div>
              <div class="actions-row"><button id="savePermissions" class="accent">保存权限</button><button class="small-btn" onclick="openDetail('${selected.id}')">打开文档详情</button></div>
              <div class="section-title"><h2>权限解读</h2></div>
              <div class="list-item"><div><strong>用户白名单</strong><p>${esc((perms.user_ids || []).map(userNameById).join('、') || '无')}</p></div></div>
              <div class="list-item"><div><strong>角色白名单</strong><p>${esc((perms.role_ids || []).map(roleNameById).join('、') || '无')}</p></div></div>
              <div class="list-item"><div><strong>部门白名单</strong><p>${esc((perms.department_ids || []).map(departmentNameById).join('、') || '无')}</p></div></div>
            ` : '<p class="subtle">选择左侧文档后可编辑其权限。</p>'}
          </section>
        </aside>
      </div>
    </section>
    <section class="panel"><h2>权限模型</h2><p class="subtle">可见级别：public / department / role / private / admin。服务端会先按用户、角色、部门和 visibility 过滤文档，再用于检索与问答上下文。</p></section>`;
  document.querySelectorAll('[data-perm-group]').forEach((node) => {
    node.addEventListener('change', () => {
      const group = node.dataset.permGroup;
      const key = group === 'users' ? 'user_ids' : group === 'roles' ? 'role_ids' : 'department_ids';
      state.permissionDraft[key] = selectedValues(group);
    });
  });
  document.querySelectorAll('[data-perm-search]').forEach((node) => {
    node.addEventListener('input', async () => {
      state.permissionSearch[node.dataset.permSearch] = node.value;
      await permissions();
    });
  });
  document.querySelectorAll('[data-perm-toggle]').forEach((node) => {
    node.addEventListener('click', async () => {
      const group = node.dataset.permToggle;
      const mode = node.dataset.permMode;
      const key = group === 'users' ? 'user_ids' : group === 'roles' ? 'role_ids' : 'department_ids';
      const current = new Set(state.permissionDraft[key] || []);
      const keyword = String(state.permissionSearch[group] || '').trim().toLowerCase();
      const source = group === 'users' ? (state.ref.users || []) : group === 'roles' ? (state.ref.roles || []) : (state.ref.departments || []);
      const labeler = group === 'users'
        ? (item) => `${item.name || item.username || item.id} (${item.id})`
        : (item) => `${item.name || item.id} (${item.id})`;
      const visibleIds = source
        .filter((item) => !keyword || labeler(item).toLowerCase().includes(keyword) || String(item.id || '').toLowerCase().includes(keyword))
        .map((item) => item.id);
      if (mode === 'visible-on') visibleIds.forEach((id) => current.add(id));
      if (mode === 'visible-off') visibleIds.forEach((id) => current.delete(id));
      state.permissionDraft[key] = [...current];
      await permissions();
    });
  });
  if ($('permVisibility')) {
    $('permVisibility').addEventListener('change', () => {
      state.permissionDraft.visibility = $('permVisibility').value;
    });
  }
  if ($('savePermissions')) {
    $('savePermissions').onclick = async () => {
      await api(`/documents/${selected.id}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({
          visibility: $('permVisibility').value,
          user_ids: state.permissionDraft.user_ids || [],
          role_ids: state.permissionDraft.role_ids || [],
          department_ids: state.permissionDraft.department_ids || []
        })
      });
      state.permissionDraft = null;
      toast('文档权限已更新');
      await permissions();
    };
  }
}

async function ai() {
  $('content').innerHTML = `
    <section class="panel">
      <div class="section-title"><h2>AI 调试台</h2><span class="subtle">保留检索模式和 Dify Chat App 调试能力</span></div>
      <textarea id="question" placeholder="例如：采购审批超过 5 万怎么处理？"></textarea>
      <div class="form-grid">
        <label>Top K<input id="topK" type="number" min="1" max="20" value="5"></label>
        <label>Conversation ID<input id="conversationId" placeholder="可留空，连续对话时会自动返回"></label>
      </div>
      <div class="actions-row">
        <button id="retrieveBtn" class="small-btn">知识库检索</button>
        <button id="chatBtn" class="accent">AI 问答</button>
      </div>
    </section>
    <div class="grid cols-2">
      <section class="panel"><div class="section-title"><h2>检索结果</h2><span class="subtle">来自 /datasets/{dataset_id}/retrieve</span></div><div id="retrieveResult" class="list"><p class="subtle">等待检索。</p></div></section>
      <section class="panel"><div class="section-title"><h2>问答结果</h2><span class="subtle">来自 /chat-messages</span></div><pre id="answer" class="preview">等待提问。</pre><div id="citations" class="list"></div></section>
    </div>`;
  const payload = () => ({
    question: $('question').value,
    top_k: Number($('topK').value || 5),
    conversation_id: $('conversationId').value
  });
  $('retrieveBtn').onclick = async () => {
    $('retrieveResult').innerHTML = '<p class="subtle">检索中...</p>';
    try {
      const result = await api('/ai/retrieve', { method: 'POST', body: JSON.stringify(payload()) });
      $('retrieveResult').innerHTML = result.chunks.length ? result.chunks.map((chunk, index) => `
        <div class="list-item"><div>
          <strong>#${index + 1} ${esc(chunk.document_name || chunk.document_id || '未知文档')}</strong>
          <small>score: ${esc(String(chunk.score ?? '-'))} · segment: ${esc(chunk.segment_id || '-')}</small>
          <p>${esc(chunk.content || '').slice(0, 900)}</p>
        </div></div>`).join('') : '<p class="subtle">没有检索到相关切片。</p>';
    } catch (err) {
      $('retrieveResult').innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  };
  $('chatBtn').onclick = async () => {
    $('answer').textContent = '生成中...';
    $('citations').innerHTML = '';
    try {
      const result = await api('/ai/chat', { method: 'POST', body: JSON.stringify(payload()) });
      $('answer').textContent = result.answer || 'Dify 没有返回答案。';
      if (result.conversation_id) $('conversationId').value = result.conversation_id;
      $('answer').textContent += `\n\n可信度: ${Number(result.confidence || 0).toFixed(2)} | 权限过滤: ${result.permission_filtered ? '是' : '否'} | 命中片段: ${result.retrieved_count || 0}`;
      $('citations').innerHTML = renderCitations(result.citations || []);
    } catch (err) {
      $('answer').textContent = err.message;
    }
  };
}

async function users() { renderSimpleTable('用户管理', state.ref.users, ['name', 'username', 'role_name', 'department_name', 'status']); }
async function roles() { renderSimpleTable('角色管理', state.ref.roles, ['name', 'permissions']); }
async function departments() { renderSimpleTable('部门管理', state.ref.departments, ['name', 'parent_id']); }
async function audit() {
  const [logs, archiveLogs, aiLogs] = await Promise.all([
    api('/audit-logs'),
    api('/archive/audit-logs'),
    api('/ai-governance/audit-logs')
  ]);
  $('content').innerHTML = `
    <section class="panel">
      <div class="section-title"><h2>审计日志</h2><span class="subtle">总日志 ${logs.length} 条 · 档案域 ${archiveLogs.length} 条 · AI 域 ${aiLogs.length} 条</span></div>
      <div class="grid cols-3">
        <section class="panel compact-panel"><div class="section-title"><h2>全部日志</h2></div><div class="table-wrap"><table><thead><tr><th>actor</th><th>action</th><th>target</th><th>detail</th><th>created_at</th></tr></thead><tbody>${logs.map((row) => `<tr><td>${esc(row.actor || '-')}</td><td>${esc(row.action || '-')}</td><td>${esc(row.target || '-')}</td><td>${esc(row.detail || '-')}</td><td>${esc(row.created_at || '-')}</td></tr>`).join('')}</tbody></table></div></section>
        <section class="panel compact-panel"><div class="section-title"><h2>档案域日志</h2></div><div class="table-wrap"><table><thead><tr><th>action</th><th>target</th><th>detail</th></tr></thead><tbody>${archiveLogs.map((row) => `<tr><td>${esc(row.action || '-')}</td><td>${esc(row.target || '-')}</td><td>${esc(row.detail || '-')}</td></tr>`).join('') || '<tr><td colspan="3" class="subtle">暂无日志。</td></tr>'}</tbody></table></div></section>
        <section class="panel compact-panel"><div class="section-title"><h2>AI 域日志</h2></div><div class="table-wrap"><table><thead><tr><th>action</th><th>target</th><th>detail</th></tr></thead><tbody>${aiLogs.map((row) => `<tr><td>${esc(row.action || '-')}</td><td>${esc(row.target || '-')}</td><td>${esc(row.detail || '-')}</td></tr>`).join('') || '<tr><td colspan="3" class="subtle">暂无日志。</td></tr>'}</tbody></table></div></section>
      </div>
    </section>`;
}

function renderSimpleTable(title, rows, keys) {
  $('content').innerHTML = `<section class="panel"><div class="section-title"><h2>${title}</h2><span class="subtle">当前提供管理浏览视图，可查看关键字段、权限与关联信息；增删改接口后续再扩展</span></div><div class="table-wrap"><table><thead><tr>${keys.map((k) => `<th>${k}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${keys.map((k) => `<td>${Array.isArray(row[k]) ? row[k].map(esc).join(', ') : esc(row[k] || '-')}</td>`).join('')}</tr>`).join('')}</tbody></table></div><pre class="preview compact-preview">${esc(JSON.stringify(rows, null, 2))}</pre></section>`;
}

async function settings() {
  const [data, mappings] = await Promise.all([api('/settings'), api('/knowledge/datasets/mapping')]);
  const rows = mappings.mappings || [];
  $('content').innerHTML = `<section class="panel"><div class="section-title"><h2>系统设置</h2><span class="subtle">当前增加 dataset mapping 配置入口</span></div><pre class="preview">${esc(JSON.stringify(data, null, 2))}</pre></section><section class="panel"><div class="section-title"><h2>Dataset Mapping</h2><span class="subtle">当前 ${rows.length} 条</span></div><div class="form-grid"><label>范围<select id="datasetScope">${optionList(state.ref.departments, '', false)}</select></label><label>档案分类<input id="datasetArchiveCategory" value="制度"></label><label>文档类型<input id="datasetDocumentType" value="通用文档"></label><label>AI 用途<select id="datasetAiScope">${optionList(['archive_only','ai_search','ai_answer'], 'ai_search', false)}</select></label><label>Dataset Key<input id="datasetKey" placeholder="例如：finance-policy-kb"></label><label>Dataset 名称<input id="datasetName" placeholder="例如：财务制度知识库"></label><label>优先级<input id="datasetPriority" type="number" value="100"></label></div><div class="actions-row"><button id="addDatasetMapping" class="accent">新增映射</button></div><div class="table-wrap"><table><thead><tr><th>范围</th><th>档案分类</th><th>文档类型</th><th>AI 用途</th><th>Dataset</th><th>优先级</th><th>启用</th><th>操作</th></tr></thead><tbody>${rows.map((item) => `<tr><td>${esc(item.scope_name || item.scope_id || '-')}</td><td><input id="datasetArchiveCategory-${item.id}" value="${esc(item.archive_category || '')}"></td><td><input id="datasetDocumentType-${item.id}" value="${esc(item.document_type || '')}"></td><td><select id="datasetAiScope-${item.id}">${optionList(['archive_only','ai_search','ai_answer'], item.ai_usage_scope || 'ai_search', false)}</select></td><td><input id="datasetName-${item.id}" value="${esc(item.dataset_name || '')}"><small class="subtle">${esc(item.dataset_key || '-')}</small></td><td><input id="datasetPriority-${item.id}" type="number" value="${esc(String(item.priority ?? 0))}"></td><td><select id="datasetEnabled-${item.id}">${optionList([{ id: 'true', name: '是' }, { id: 'false', name: '否' }], String(item.enabled !== false), false)}</select></td><td><button class="small-btn" onclick="saveDatasetMapping('${item.id}')">保存</button><button class="small-btn" onclick="toggleDatasetMapping('${item.id}')">${item.enabled === false ? '启用' : '停用'}</button><button class="small-btn warn" onclick="deleteDatasetMapping('${item.id}')">删除</button></td></tr>`).join('') || '<tr><td colspan="8" class="subtle">暂无映射。</td></tr>'}</tbody></table></div><pre class="preview compact-preview">${esc(JSON.stringify(rows, null, 2))}</pre></section>`;
  $('addDatasetMapping').onclick = async () => {
    const scopeId = $('datasetScope').value;
    const scope = (state.ref.departments || []).find((item) => item.id === scopeId);
    const next = [...rows, {
      scope_type: 'department',
      scope_id: scopeId,
      scope_name: scope?.name || scopeId,
      archive_category: $('datasetArchiveCategory').value,
      document_type: $('datasetDocumentType').value,
      ai_usage_scope: $('datasetAiScope').value,
      dataset_key: $('datasetKey').value,
      dataset_name: $('datasetName').value,
      enabled: true,
      priority: Number($('datasetPriority').value || 100),
      note: ''
    }].filter((item) => item.dataset_key);
    await api('/knowledge/datasets/mapping', {
      method: 'PATCH',
      body: JSON.stringify({ mappings: next })
    });
    toast('Dataset mapping 已更新');
    await settings();
  };
}

async function roadmap() {
  const items = state.ref.capabilities || [];
  $('content').innerHTML = `<section class="panel"><div class="section-title"><h2>预留功能</h2><span class="subtle">能力清单与扩展路线</span></div>${list(items, (item) => `<strong>${esc(item.name)}</strong><small>${esc(item.status)} · ${esc(item.note || '')}</small>`)}</section>`;
}

init();
