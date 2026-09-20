// ==================== 月明智能管理平台 v2.0 ====================
// 访问路径: /new

(function () {
  'use strict';

  // ==================== 全局状态 ====================
  const state = {
    user: { name: '管理员', role: 'admin', avatar: 'A' },
    contracts: [],
    selectedContract: null,
    currentPage: 'dashboard',
    collapsed: false,
    alerts: [],
    docs: [],
    scanResults: [],
    knowledgeDocs: [],
    oaConfigs: [],
  };

  // ==================== 工具函数 ====================
  const $ = (id) => document.getElementById(id);
  const esc = (v = '') => String(v).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const fmt = (iso) => iso ? dayjs(iso).format('YYYY-MM-DD') : '-';
  const fmtDateTime = (iso) => iso ? dayjs(iso).format('YYYY-MM-DD HH:mm') : '-';
  const fmtMoney = (n) => '¥' + Number(n || 0).toLocaleString();
  const daysDiff = (from, to) => Math.floor((new Date(to) - new Date(from)) / 864e5);

  function toast(msg, type = 'info') {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast show';
    setTimeout(() => el.classList.remove('show'), 3000);
  }

  function showModal(title, bodyHtml, footerHtml) {
    $('modalContent').innerHTML = '<div class="modal-header"><h3>' + esc(title) + '</h3><button class="btn btn-ghost" onclick="document.getElementById(\'modalOverlay\').style.display=\'none\'">✕</button></div><div class="modal-body">' + bodyHtml + '</div>' + (footerHtml ? '<div class="modal-footer">' + footerHtml + '</div>' : '');
    $('modalOverlay').style.display = 'flex';
  }

  function hideModal() { $('modalOverlay').style.display = 'none'; }

  // ==================== MOCK 数据生成 ====================
  const now = new Date();
  const dAgo = (d) => new Date(now - d * 864e5).toISOString().slice(0, 10);
  const dLater = (d) => new Date(now.getTime() + d * 864e5).toISOString().slice(0, 10);

  function initMockData() {
    state.contracts = [
      { id: '1', code: 'HT-2024-001', partyA: '北京星辰科技有限公司', partyB: '上海月明信息系统有限公司', signDate: dAgo(90), effectiveDate: dAgo(80), expireDate: dLater(280), dept: '销售部', handler: '张伟', amount: 1280000, subject: '智能监测系统采购及实施', unitPrice: 64000, taxRate: 13, paymentTerms: '签约30%，验收65%，质保金5%', deposit: 64000, deliverables: '设备交付、系统部署、操作培训', acceptanceStandard: 'GB/T 19001-2016 质量管理体系标准', servicePeriod: '12个月质保期', renewalConditions: '续约需提前60日书面通知', stage: 'S6_履约', status: 'active', createdAt: dAgo(90), updatedAt: dAgo(5) },
      { id: '2', code: 'HT-2024-002', partyA: '深圳华腾数据集团', partyB: '上海月明信息系统有限公司', signDate: dAgo(45), effectiveDate: dLater(10), expireDate: dLater(370), dept: '技术部', handler: '李娜', amount: 3560000, subject: '大数据平台运维服务', unitPrice: 890000, taxRate: 6, paymentTerms: '按季度付款，每季度末支付当季度服务费', deposit: 0, deliverables: '季度运维报告、月度巡检、故障响应', acceptanceStandard: 'SLA 99.5%可用性', servicePeriod: '24个月（可按年续约）', renewalConditions: '自动续约除非任何一方在到期前30日通知不续约', stage: 'S5_签订', status: 'active', createdAt: dAgo(45), updatedAt: dAgo(2) },
      { id: '3', code: 'HT-2024-003', partyA: '杭州云帆电子商务有限公司', partyB: '上海月明信息系统有限公司', signDate: dAgo(120), effectiveDate: dAgo(110), expireDate: dLater(30), dept: '客户二部', handler: '王磊', amount: 580000, subject: '在线客服系统升级', unitPrice: 29000, taxRate: 13, paymentTerms: '签约50%，上线验收50%', deposit: 0, deliverables: '客服系统升级、数据迁移、人员培训', acceptanceStandard: '功能测试通过率100%', servicePeriod: '6个月质保期', renewalConditions: '无自动续约条款', stage: 'S6_履约', status: 'risk', createdAt: dAgo(120), updatedAt: dAgo(1) },
      { id: '4', code: 'HT-2024-004', partyA: '广州东方制造集团', partyB: '上海月明信息系统有限公司', signDate: dLater(15), effectiveDate: dLater(20), expireDate: dLater(385), dept: '销售部', handler: '陈静', amount: 2100000, subject: 'MES制造执行系统定制开发', unitPrice: 1050000, taxRate: 13, paymentTerms: '签约20%，需求确认30%，上线验收45%，质保金5%', deposit: 420000, deliverables: '需求分析、系统开发、部署上线、培训交付', acceptanceStandard: '功能性测试、性能压测、用户验收', servicePeriod: '12个月免费维护', renewalConditions: '后续功能扩展需签订补充协议', stage: 'S4_确认', status: 'pending', createdAt: dAgo(10), updatedAt: dAgo(10) },
      { id: '5', code: 'HT-2023-089', partyA: '成都西部科创有限公司', partyB: '上海月明信息系统有限公司', signDate: dAgo(400), effectiveDate: dAgo(390), expireDate: dAgo(20), dept: '技术部', handler: '赵强', amount: 920000, subject: '网络安全加固服务', unitPrice: 46000, taxRate: 6, paymentTerms: '签约100%', deposit: 0, deliverables: '安全评估报告、加固方案、渗透测试', acceptanceStandard: '等保2.0三级合规', servicePeriod: '合同履行完毕', renewalConditions: '无续约条款', stage: 'completed', status: 'completed', createdAt: dAgo(400), updatedAt: dAgo(20) },
    ];

    state.alerts = [
      { id: 'ra-1', contractId: '3', contractCode: 'HT-2024-003', level: 'high', type: '到期预警', content: '合同将于30天内到期，需安排续约或交接', suggestion: '联系客户确认续约意愿，启动交接准备', historyRef: 'HT-2023-089 到期前未及时交接导致服务空档', createdAt: dAgo(1), resolved: false },
      { id: 'ra-2', contractId: '1', contractCode: 'HT-2024-001', level: 'medium', type: '付款提醒', content: '本期巡检报告已提交30天，对应付款节点将到', suggestion: '确认验收状态并启动付款流程', historyRef: 'HT-2024-001 首次付款延迟14天', createdAt: dAgo(3), resolved: false },
      { id: 'ra-3', contractId: '2', contractCode: 'HT-2024-002', level: 'low', type: '服务提醒', content: '距下次月度巡检还有7天', suggestion: '安排巡检人员与客户对接', createdAt: dAgo(1), resolved: false },
    ];

    state.knowledgeDocs = [
      { id: 'd1', title: '研发设计规范 v3.2', description: '统一研发设计输出规范，含流程图、接口文档模板', filename: 'design_spec_v3.2.md', fileType: 'md', size: 24500, folder: '研发规范', versions: [{ version: '3.2', filename: 'design_spec_v3.2.md', size: 24500, updatedAt: dAgo(10), author: '技术部', changelog: '新增微服务接口规范章节' }], tags: ['研发', '规范', '设计'], summary: '本文档定义了公司在产品研发过程中的设计输出规范，包括流程图绘制标准、接口文档模板、数据库设计准则等。', linkedSoftware: 'PLM-v2.3', permissions: { roles: ['admin', 'manager', 'user'], public: true }, createdAt: dAgo(60), updatedAt: dAgo(10) },
      { id: 'd2', title: '方案评审规则手册', description: '方案评审流程、评分标准、常见问题与建议', filename: 'review_rules.md', fileType: 'md', size: 18200, folder: '评审规则', versions: [{ version: '2.1', filename: 'review_rules.md', size: 18200, updatedAt: dAgo(15), author: '质量部', changelog: '增加AI辅助评审说明' }], tags: ['评审', '流程', '质量'], summary: '本手册详细说明了内部技术方案评审的完整流程、评分维度、评审委员会组成及常见问题处理建议。', linkedSoftware: '', permissions: { roles: ['admin', 'manager'], public: false }, createdAt: dAgo(45), updatedAt: dAgo(15) },
      { id: 'd3', title: '系统集成技术白皮书', description: '第三方系统集成方案、接口标准、安全要求', filename: 'integration_wp.pdf', fileType: 'pdf', size: 560000, folder: '技术方案', versions: [{ version: '1.0', filename: 'integration_wp.pdf', size: 560000, updatedAt: dAgo(20), author: '架构组', changelog: '初始发布' }], tags: ['集成', '架构', '接口'], summary: '详细阐述了与金蝶、用友等主流OA/ERP系统的集成技术方案，包括鉴权机制、字段映射、数据同步策略与安全合规要求。', linkedSoftware: 'OA-Connector-v1.0', permissions: { roles: ['admin', 'manager'], public: false }, createdAt: dAgo(20), updatedAt: dAgo(20) },
      { id: 'd4', title: 'API接口设计规范', description: 'RESTful API 设计标准、命名规范、错误码定义', filename: 'api_design_spec.md', fileType: 'md', size: 18900, folder: '研发规范', versions: [{ version: '1.0', filename: 'api_design_spec.md', size: 18900, updatedAt: dAgo(5), author: '架构组', changelog: '初始发布' }], tags: ['API', '规范', '接口'], summary: '定义了公司内部及对外 API 的统一设计规范，包括资源命名、HTTP方法使用、请求/响应格式、错误码体系及版本管理策略。', linkedSoftware: '', permissions: { roles: ['admin', 'manager', 'user'], public: true }, createdAt: dAgo(5), updatedAt: dAgo(5) },
    ];

    state.oaConfigs = [
      { id: 'oa-1', platform: 'yonyou', enabled: true, syncType: 'daily', endpoint: 'https://api.yonyoucloud.com/v1/enterprise/sync', apiKey: 'yonyou-key-****-demo', apiSecret: '****', fieldMappings: [
        { local: 'contract.code', remote: 'contract_no', transform: 'uppercase' },
        { local: 'contract.amount', remote: 'total_amount', transform: 'number' },
        { local: 'contract.partyA', remote: 'customer_name', transform: '' },
        { local: 'contract.signDate', remote: 'sign_date', transform: 'date' },
      ], lastSyncAt: dAgo(1) + 'T02:00:00', lastSyncStatus: 'success' },
      { id: 'oa-2', platform: 'jd', enabled: false, syncType: 'manual', endpoint: 'https://open.jdy.com/api/v1/sync', apiKey: '', apiSecret: '', fieldMappings: [], lastSyncAt: null, lastSyncStatus: null },
    ];
  }

  // ==================== AI 引擎 (Mock) ====================
  const AI = {
    delay: (ms) => new Promise(r => setTimeout(r, ms)),
    sensitiveWords: ['独家经营', '保证最低', '霸王条款', '免责一切', '概不负责', '最终解释权', '放弃索赔', '无理由退款', '包销', '垄断'],
    regulations: [
      { code: 'GB/T 19001-2016', name: '质量管理体系标准' },
      { code: 'GB/T 24001-2016', name: '环境管理体系标准' },
      { code: 'GB/T 45001-2020', name: '职业健康安全管理体系标准' },
      { code: 'CSC-2024-001', name: '网络安全等级保护基本要求' },
      { code: 'CSL-2023-018', name: '数据安全法合规指引' },
    ],

    async simulateOCR(fileName) {
      await this.delay(1800);
      return {
        fields: [
          { field: '合同编号', value: 'HT-2024-AI-' + Date.now().toString().slice(-4), confidence: 0.94 },
          { field: '甲方名称', value: fileName.replace(/\.[^.]+$/, '').slice(0, 20), confidence: 0.82 },
          { field: '乙方名称', value: '上海月明信息系统有限公司', confidence: 0.97 },
          { field: '签订日期', value: dLater(0), confidence: 0.91 },
          { field: '合同总金额', value: '¥1,000,000', confidence: 0.88 },
          { field: '付款条件', value: '签约40%，验收55%，质保金5%', confidence: 0.79 },
          { field: '服务期限', value: '12个月', confidence: 0.72 },
          { field: '交付物', value: '系统部署、培训交付', confidence: 0.68 },
        ],
        rawText: '合同编号：HT-2024-AI-' + Date.now().toString().slice(-4) + '\n甲方：' + fileName.replace(/\.[^.]+$/, '').slice(0, 20) + '\n乙方：上海月明信息系统有限公司\n签订日期：' + dLater(0) + '\n合同总金额：人民币壹佰万元整（¥1,000,000）\n付款条件：合同签订后支付40%，验收合格后支付55%，质保金5%\n服务期限：自合同生效之日起12个月\n交付物：系统部署、用户培训、操作手册',
      };
    },

    async checkSensitive(text) {
      await this.delay(800);
      return this.sensitiveWords.map(w => ({ word: w, found: text.includes(w) })).filter(r => r.found);
    },

    async checkRegulations(contract) {
      await this.delay(1500);
      return this.regulations.map(r => ({
        regulation: r.code + ' ' + r.name,
        compliant: Math.random() > 0.25,
        note: Math.random() > 0.25 ? '合同条款与该法规标准一致' : '检测到可能的合规偏差，建议人工复核。历史案例显示类似偏差平均处理时间2.3天。',
      }));
    },

    async compareHistory(contract) {
      await this.delay(1000);
      return [
        { field: '合同总金额', current: fmtMoney(contract.amount || 0), avgHistory: '¥1,856,000', deviation: contract.amount > 1500000 ? '+12.6%' : '-31.2%', advice: contract.amount > 1500000 ? '该金额高于历史同类合同均值，建议确认是否存在特殊约定' : '该金额低于历史同类合同均值，建议确认是否存在特殊约定或需补充条款' },
        { field: '付款条件', current: contract.paymentTerms || 'N/A', avgHistory: '签约30%，验收60%，质保金10%', deviation: '偏离', advice: '建议与标准付款条件比对，确认客户特殊要求是否已合法约定' },
        { field: '合同标的物', current: contract.subject || 'N/A', avgHistory: '系统/平台类占72%', deviation: '正常', advice: '行业分布正常，属于常规标的物范围' },
      ];
    },

    async generateScan(contractCode, apiKey) {
      await this.delay(2500);
      const pool = [
        { severity: 'error', type: '安全', message: '发现硬编码 API Key 或凭证', file: 'config/secrets.ts', line: 7, suggestion: '请将敏感信息移至环境变量或密钥管理系统' },
        { severity: 'warning', type: '性能', message: 'API 响应时间超过阈值 1.5s', file: 'api/query.ts', line: 23, suggestion: '建议添加缓存层或优化数据库查询语句' },
        { severity: 'warning', type: '依赖', message: '依赖包存在 CVE 已知漏洞', file: 'package.json', line: 18, suggestion: '建议升级相关依赖至安全版本' },
        { severity: 'info', type: '规范', message: '类型定义不够严格，建议使用更精确的类型', file: 'types/common.ts', line: 5, suggestion: '使用 type 替代 any，提升类型安全性' },
        { severity: 'info', type: '规范', message: '缺少 JSDoc 注释', file: 'utils/helper.ts', line: 11, suggestion: '为导出函数添加 JSDoc 注释，提升可维护性' },
      ];
      const count = 2 + Math.floor(Math.random() * 2);
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      return { id: 'cs-' + Date.now(), scanId: 'scan-' + Date.now().toString().slice(-6), contractCode, apiKey: apiKey.slice(0, 8) + '****', triggeredAt: new Date().toISOString(), issues: shuffled.slice(0, count), status: 'completed' };
    },

    async generateDocSummary(content) {
      await this.delay(1500);
      const sentences = content.split(/[。\n]/).filter(Boolean);
      const summary = sentences.slice(0, 3).join('。') + '。';
      const tags = ['文档', '系统'];
      if (/规范|标准/.test(content)) tags.push('规范');
      if (/评审/.test(content)) tags.push('评审');
      if (/接口|API/.test(content)) tags.push('接口');
      if (/安全/.test(content)) tags.push('安全');
      if (/设计/.test(content)) tags.push('设计');
      return { summary, tags: [...new Set(tags)] };
    },

    async generateAlerts(contracts) {
      await this.delay(600);
      const alerts = [];
      contracts.forEach(c => {
        if (c.status === 'completed') return;
        const diff = (new Date(c.expireDate) - new Date()) / 864e5;
        if (diff < 0) {
          alerts.push({ id: 'ra-' + Date.now() + '-' + c.id + '-1', contractId: c.id, contractCode: c.code, level: 'high', type: '到期预警', content: '合同 ' + c.code + ' 已逾期 ' + Math.abs(Math.floor(diff)) + ' 天，需立即处理', suggestion: '立即联系客户确认状态，启动法律或业务补救流程', createdAt: new Date().toISOString(), resolved: false });
        } else if (diff < 60) {
          alerts.push({ id: 'ra-' + Date.now() + '-' + c.id + '-2', contractId: c.id, contractCode: c.code, level: diff < 30 ? 'high' : 'medium', type: '到期预警', content: '合同 ' + c.code + ' 将于 ' + Math.floor(diff) + ' 天后到期', suggestion: '提前安排续约谈判或服务交接', createdAt: new Date().toISOString(), resolved: false });
        }
        if (c.amount > 1000000 && c.stage !== 'S6_履约') {
          alerts.push({ id: 'ra-' + Date.now() + '-' + c.id + '-3', contractId: c.id, contractCode: c.code, level: 'medium', type: '大额合同提醒', content: '合同 ' + c.code + ' 金额 ¥' + c.amount.toLocaleString() + '，当前处于 ' + c.stage + ' 阶段', suggestion: '大额合同建议增加阶段性审核节点', createdAt: new Date().toISOString(), resolved: false });
        }
      });
      return alerts;
    },
  };

  // ==================== 页面渲染器 ====================

  // ---------- 工作台 ----------
  function renderDashboard() {
    const total = state.contracts.length;
    const active = state.contracts.filter(c => c.status === 'active').length;
    const risk = state.contracts.filter(c => c.status === 'risk').length;
    const expiring = state.contracts.filter(c => { const d = daysDiff(new Date(), c.expireDate); return d > 0 && d < 60 && c.status !== 'completed'; }).length;
    const totalAmount = state.contracts.reduce((s, c) => s + c.amount, 0);
    const recentContracts = [...state.contracts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
    const pendingAlerts = state.alerts.filter(a => !a.resolved);

    $('pageTitle').textContent = '工作台';
    $('pageKicker').textContent = 'Dashboard';

    $('content').innerHTML = `
      <!-- 统计卡片 -->
      <div class="stat-grid">
        <div class="stat-card" data-nav="contract">
          <div class="stat-label">合同总数</div>
          <div class="stat-value">${total}</div>
          <div class="stat-desc">签约总额 ${fmtMoney(totalAmount)}</div>
        </div>
        <div class="stat-card" data-nav="contract">
          <div class="stat-label">履约中</div>
          <div class="stat-value text-green">${active}</div>
          <div class="stat-desc">正常运行</div>
        </div>
        <div class="stat-card" data-nav="contract-risk">
          <div class="stat-label text-red">风险合同</div>
          <div class="stat-value text-red">${risk}</div>
          <div class="stat-desc">需关注</div>
        </div>
        <div class="stat-card" data-nav="contract-risk">
          <div class="stat-label" style="color:var(--orange)">待处理提醒</div>
          <div class="stat-value" style="color:var(--orange)">${pendingAlerts.length}</div>
          <div class="stat-desc">条未解决</div>
        </div>
        <div class="stat-card" data-nav="contract">
          <div class="stat-label">即将到期</div>
          <div class="stat-value" style="color:var(--orange)">${expiring}</div>
          <div class="stat-desc">60天内</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">本月新增</div>
          <div class="stat-value">${state.contracts.filter(c => { const d = new Date(c.createdAt); const n = new Date(); return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear(); }).length}</div>
          <div class="stat-desc">较上月 +2</div>
        </div>
      </div>

      <!-- 主内容区 -->
      <div class="grid-2-1">
        <!-- 合同概览 -->
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">📋 合同概览</div>
              <div class="card-subtitle">最近更新的合同</div>
            </div>
            <button class="btn btn-ghost btn-sm" data-nav="contract">查看全部 →</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>编号</th><th>甲方</th><th>金额</th><th>阶段</th><th>状态</th><th>更新日期</th></tr></thead>
              <tbody>
                ${recentContracts.map(c => `<tr style="cursor:pointer" data-nav="contract-${c.id}">
                  <td class="text-bold text-primary">${esc(c.code)}</td>
                  <td>${esc(c.partyA)}</td>
                  <td class="text-bold">${fmtMoney(c.amount)}</td>
                  <td><span class="tag tag-blue">${esc(c.stage)}</span></td>
                  <td><span class="tag ${c.status === 'risk' ? 'tag-red' : c.status === 'active' ? 'tag-green' : 'tag-default'}">${c.status === 'active' ? '履约中' : c.status === 'risk' ? '风险' : c.status === 'pending' ? '待处理' : '已完成'}</span></td>
                  <td>${fmt(c.updatedAt)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- 右侧面板 -->
        <div style="display:grid;gap:16px">
          <!-- 快捷操作 -->
          <div class="card">
            <div class="card-title mb-12">⚡ 快捷操作</div>
            <div style="display:grid;gap:8px">
              <button class="btn btn-outline" style="text-align:left;justify-content:flex-start" data-nav="contract">📋 新建合同</button>
              <button class="btn btn-outline" style="text-align:left;justify-content:flex-start" data-nav="contract-upload">🤖 AI 提取录入</button>
              <button class="btn btn-outline" style="text-align:left;justify-content:flex-start" data-nav="contract-review">🔍 合同评审</button>
              <button class="btn btn-outline" style="text-align:left;justify-content:flex-start" data-nav="knowledge">📚 上传文档</button>
            </div>
          </div>

          <!-- 近期提醒 -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">⚠️ 近期提醒</div>
              <button class="btn btn-ghost btn-sm" data-nav="contract-risk">全部 →</button>
            </div>
            <div style="display:grid;gap:8px">
              ${pendingAlerts.slice(0, 3).map(a => `
                <div class="risk-card ${a.level}" style="padding:10px 12px;border-radius:6px;border-left:3px solid ${a.level === 'high' ? 'var(--red)' : a.level === 'medium' ? 'var(--orange)' : 'var(--cyan)'};background:${a.level === 'high' ? '#fff1f0' : a.level === 'medium' ? '#fffbe6' : '#e6fffb'}">
                  <div class="text-bold" style="font-size:13px">${esc(a.contractCode)} · ${esc(a.type)}</div>
                  <div style="font-size:12px;color:var(--muted);margin-top:2px">${esc(a.content).slice(0, 40)}...</div>
                </div>
              `).join('')}
              ${!pendingAlerts.length ? '<div class="text-muted" style="text-align:center;padding:16px">暂无待处理提醒</div>' : ''}
            </div>
          </div>
        </div>
      </div>

      <!-- 系统公告 -->
      <div class="card mt-20">
        <div class="card-header"><div class="card-title">📢 系统公告</div></div>
        <ul class="timeline">
          <li><div class="timeline-dot" style="background:var(--green)"></div><div class="timeline-content"><strong>v2.1.0 发布</strong><br><span class="text-muted">新增合同评审 AI 辅助模块，支持敏感词检测与法规比对。AI 提取数据与人工数据分开存储。</span></div></li>
          <li><div class="timeline-dot" style="background:var(--primary)"></div><div class="timeline-content"><strong>知识库更新</strong><br><span class="text-muted">方案评审规则手册 v2.1 上线，新增 AI 辅助评审说明章节。研发设计规范 v3.2 同步发布。</span></div></li>
          <li><div class="timeline-dot" style="background:var(--orange)"></div><div class="timeline-content"><strong>维护通知</strong><br><span class="text-muted">OA 数据同步接口升级计划于本周执行，预计停机 2 小时。已提前通知各单位。</span></div></li>
        </ul>
      </div>
    `;
  }

  // ---------- 合同列表（深化） ----------
  function renderContractList() {
    $('pageTitle').textContent = '合同管理';
    $('pageKicker').textContent = 'Contracts';

    // 统计
    const total = state.contracts.length;
    const totalAmount = state.contracts.reduce((s, c) => s + c.amount, 0);
    const s4 = state.contracts.filter(c => c.stage === 'S4_确认').length;
    const s5 = state.contracts.filter(c => c.stage === 'S5_签订').length;
    const s6 = state.contracts.filter(c => c.stage === 'S6_履约').length;

    $('content').innerHTML = `
      <!-- 阶段统计 -->
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">合同总数</div><div class="stat-value">${total}</div><div class="stat-desc">总额 ${fmtMoney(totalAmount)}</div></div>
        <div class="stat-card" style="border-left:3px solid var(--primary)"><div class="stat-label" style="color:var(--primary)">S4 项目确认</div><div class="stat-value" style="color:var(--primary)">${s4}</div><div class="stat-desc">待确认</div></div>
        <div class="stat-card" style="border-left:3px solid var(--orange)"><div class="stat-label" style="color:var(--orange)">S5 合同签订</div><div class="stat-value" style="color:var(--orange)">${s5}</div><div class="stat-desc">待签约</div></div>
        <div class="stat-card" style="border-left:3px solid var(--green)"><div class="stat-label" style="color:var(--green)">S6 合同履约</div><div class="stat-value" style="color:var(--green)">${s6}</div><div class="stat-desc">执行中</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">合同列表</div>
            <div class="card-subtitle">全流程可视化管理 · S4 → S5 → S6 → 完成</div>
          </div>
          <button class="btn btn-primary" onclick="window._newContract()">+ 新建合同</button>
        </div>

        <!-- 高级筛选 -->
        <div class="form-grid mb-16" style="background:#fafbfc;padding:16px;border-radius:8px">
          <div class="form-group"><div class="form-label">搜索</div><input class="form-input" id="searchKw" placeholder="编号/甲方/标的物/经办人"></div>
          <div class="form-group"><div class="form-label">阶段</div><select class="form-input" id="filterStage"><option value="">全部阶段</option><option value="S4_确认">S4 项目确认</option><option value="S5_签订">S5 合同签订</option><option value="S6_履约">S6 合同履约</option><option value="completed">已完成</option></select></div>
          <div class="form-group"><div class="form-label">状态</div><select class="form-input" id="filterStatus"><option value="">全部状态</option><option value="active">履约中</option><option value="pending">待处理</option><option value="risk">风险</option><option value="completed">已完成</option></select></div>
          <div class="form-group"><div class="form-label">经办部门</div><select class="form-input" id="filterDept"><option value="">全部部门</option><option value="销售部">销售部</option><option value="技术部">技术部</option><option value="客户二部">客户二部</option></select></div>
        </div>
        <div class="btn-row mb-12">
          <button class="btn btn-primary btn-sm" onclick="window._filterContracts()">🔍 查询</button>
          <button class="btn btn-outline btn-sm" onclick="location.reload()">重置</button>
          <button class="btn btn-outline btn-sm" onclick="window._batchExport()">📥 批量导出</button>
        </div>
        <div id="contractTable"></div>
      </div>
    `;
    renderContractTable(state.contracts);
  }

  function renderContractTable(data) {
    const d = data || state.contracts;
    const stageColor = { 'S4_确认': 'tag-blue', 'S5_签订': 'tag-orange', 'S6_履约': 'tag-green', 'completed': 'tag-default' };
    const statusColor = { 'active': 'tag-green', 'pending': 'tag-blue', 'completed': 'tag-default', 'risk': 'tag-red' };
    const statusLabel = { 'active': '履约中', 'pending': '待处理', 'completed': '已完成', 'risk': '风险' };
    const daysLeft = (c) => { const d = daysDiff(new Date(), c.expireDate); return d > 0 ? d : 0; };

    $('contractTable').innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" onchange="this.checked ? document.querySelectorAll('#contractTable tbody input[type=checkbox]').forEach(cb => cb.checked = true) : document.querySelectorAll('#contractTable tbody input[type=checkbox]').forEach(cb => cb.checked = false)"></th>
              <th>编号</th><th>甲方</th><th>标的物</th><th>金额</th><th>阶段</th><th>状态</th>
              <th>剩余天数</th><th>签订日期</th><th>经办人</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${d.map(c => `<tr>
              <td><input type="checkbox"></td>
              <td class="text-bold text-primary" style="cursor:pointer" data-nav="contract-${c.id}">${esc(c.code)}</td>
              <td>${esc(c.partyA)}</td>
              <td>${esc(c.subject)}</td>
              <td class="text-bold">${fmtMoney(c.amount)}</td>
              <td><span class="tag ${stageColor[c.stage] || 'tag-default'}">${esc(c.stage)}</span></td>
              <td><span class="tag ${statusColor[c.status]}">${statusLabel[c.status]}</span></td>
              <td><span class="${daysLeft(c) < 30 ? 'text-red' : daysLeft(c) < 60 ? 'text-orange' : ''}">${c.status === 'completed' ? '—' : daysLeft(c) + '天'}</span></td>
              <td>${fmt(c.signDate)}</td>
              <td>${esc(c.handler)}</td>
              <td>
                <button class="btn btn-ghost btn-sm" data-nav="contract-${c.id}">详情</button>
                <button class="btn btn-ghost btn-sm text-orange" onclick="window._setStage('${c.id}')">推进</button>
              </td>
            </tr>`).join('')}
            ${!d.length ? '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--muted)">暂无合同，请新建或导入</td></tr>' : ''}
          </tbody>
        </table>
      </div>
      <div class="mt-12" style="display:flex;justify-content:space-between;align-items:center">
        <span class="text-muted">共 ${d.length} 条记录${d.length !== state.contracts.length ? '（筛选结果）' : ''}</span>
        <span class="text-muted">总额：${fmtMoney(d.reduce((s, c) => s + c.amount, 0))}</span>
      </div>
    `;
  }

  // ---------- 合同详情（深化） ----------
  function renderContractDetail(id) {
    const c = state.contracts.find(x => x.id === id);
    if (!c) { $('content').innerHTML = '<div class="empty"><div class="empty-icon">📋</div><p>合同未找到</p></div>'; return; }
    state.selectedContract = c;
    const stepIdx = { 'S4_确认': 0, 'S5_签订': 1, 'S6_履约': 2, 'completed': 3 }[c.stage] || 0;
    const steps = ['S4 项目确认', 'S5 合同签订', 'S6 合同履约', '已完成'];

    const daysElapsed = daysDiff(c.effectiveDate, new Date());
    const daysRemain = Math.max(0, daysDiff(new Date(), c.expireDate));
    const progressPercent = Math.min(100, Math.round((daysElapsed / (daysElapsed + daysRemain)) * 100)) || 0;

    $('pageTitle').textContent = c.code;
    $('pageKicker').textContent = c.subject;

    $('content').innerHTML = `
      <button class="btn btn-outline btn-sm mb-16" data-nav="contract">← 返回合同列表</button>

      <!-- 流程可视化 -->
      <div class="card mb-16">
        <div class="card-header">
          <div class="card-title">📊 合同流程可视化</div>
          <span class="tag ${c.status === 'risk' ? 'tag-red' : c.status === 'active' ? 'tag-green' : c.status === 'completed' ? 'tag-default' : 'tag-blue'}">${c.status === 'active' ? '履约中' : c.status === 'risk' ? '风险' : c.status === 'completed' ? '已完成' : '待处理'}</span>
        </div>
        <div class="steps">
          ${steps.map((s, i) => `<div class="step ${i <= stepIdx ? (i < stepIdx ? 'done' : 'active') : ''}"><div class="step-dot">${i < stepIdx ? '✓' : i + 1}</div><span class="step-label">${s}</span></div>${i < 3 ? '<div class="step-line ' + (i < stepIdx ? 'done' : '') + '"></div>' : ''}`).join('')}
        </div>
        <!-- His next action buttons -->
        <div style="text-align:center;margin-top:12px;padding:12px;background:#fafbfc;border-radius:8px">
          ${stepIdx === 0 ? '<button class="btn btn-primary" onclick="window._advanceStage(\'' + c.id + '\', \'S5_签订\')">✓ 确认通过，推进至签订</button>' : ''}
          ${stepIdx === 1 ? '<button class="btn btn-primary" onclick="window._advanceStage(\'' + c.id + '\', \'S6_履约\')">✓ 签订完成，开始履约</button>' : ''}
          ${stepIdx === 2 ? '<button class="btn btn-primary" onclick="window._advanceStage(\'' + c.id + '\', \'completed\')">✓ 确定完成，归档</button>' : ''}
          ${stepIdx === 3 ? '<span class="tag tag-green">✅ 合同流程已全部完成</span>' : ''}
          ${c.status === 'risk' ? '<span class="tag tag-red ml-8">⚠️ 此合同存在风险，请查看风险提醒</span>' : ''}
        </div>
      </div>

      <!-- 详情 Tabs -->
      <div class="card">
        <div class="tabs" data-tab-group="detail">
          <button class="tab-btn active" data-tab="info">📋 基本信息</button>
          <button class="tab-btn" data-tab="ai">🤖 AI 处理</button>
          <button class="tab-btn" data-tab="flow">📜 流程记录</button>
          <button class="tab-btn" data-tab="finance">💰 财务信息</button>
        </div>

        <!-- Tab: 基本信息 -->
        <div id="tab-info" class="tab-content">
          <table class="kv-table">
            <tr><td class="kv-label">合同编号</td><td class="text-bold">${esc(c.code)}</td><td class="kv-label">合同状态</td><td><span class="tag ${statusColor[c.status]}">${statusLabel[c.status]}</span></td></tr>
            <tr><td class="kv-label">甲方</td><td>${esc(c.partyA)}</td><td class="kv-label">乙方</td><td>${esc(c.partyB)}</td></tr>
            <tr><td class="kv-label">签订日期</td><td>${fmt(c.signDate)}</td><td class="kv-label">生效日期</td><td>${fmt(c.effectiveDate)}</td></tr>
            <tr><td class="kv-label">到期日期</td><td>${fmt(c.expireDate)}<br><span class="${daysRemain < 30 && c.status !== 'completed' ? 'text-red' : 'text-muted'}" style="font-size:12px">剩余 ${daysRemain} 天</span></td><td class="kv-label">保障期</td><td>${esc(c.servicePeriod)}</td></tr>
            <tr><td class="kv-label">经办部门</td><td>${esc(c.dept)}</td><td class="kv-label">经办人</td><td>${esc(c.handler)}</td></tr>
            <tr><td class="kv-label">合同总金额</td><td class="text-bold" style="font-size:20px;color:var(--primary)">${fmtMoney(c.amount)}</td><td class="kv-label">单价</td><td>${fmtMoney(c.unitPrice)}</td></tr>
            <tr><td class="kv-label">税率</td><td>${c.taxRate}%</td><td class="kv-label">保证金</td><td>${c.deposit ? fmtMoney(c.deposit) : '无'}</td></tr>
            <tr><td class="kv-label">付款条件</td><td colspan="3">${esc(c.paymentTerms)}</td></tr>
            <tr><td class="kv-label">交付物</td><td colspan="3">${esc(c.deliverables)}</td></tr>
            <tr><td class="kv-label">验收标准</td><td colspan="3">${esc(c.acceptanceStandard)}</td></tr>
            <tr><td class="kv-label">续约条件</td><td colspan="3">${esc(c.renewalConditions)}</td></tr>
          </table>
        </div>

        <!-- Tab: AI 处理 -->
        <div id="tab-ai" class="tab-content hidden">
          <p class="text-muted mb-12">AI 提取数据与人工填写数据分开存储，不合并。点击下方按钮对合同进行智能字段提取。</p>
          <button class="btn btn-primary mb-12" onclick="window._runAIExtract('${c.id}')">⚡ 智能提取字段信息</button>
          <div id="aiExtractResult"></div>
          ${c.aiExtracted ? `<div class="card mt-12" style="background:#f8f8f8"><div class="card-title mb-8">OCR 原始文本（来源：${esc(c.aiExtracted.sourceFile || '扫描件')}）</div><pre style="white-space:pre-wrap;font-size:12px;max-height:220px;overflow:auto;padding:12px;background:#f0f0f0;border-radius:6px">${esc(c.aiExtracted.rawText)}</pre></div>` : ''}
        </div>

        <!-- Tab: 流程记录 -->
        <div id="tab-flow" class="tab-content hidden">
          <ul class="timeline">
            <li><div class="timeline-dot" style="background:var(--green)"></div><div class="timeline-content"><strong>合同创建</strong><br><span class="text-muted">经办人 ${esc(c.handler)} 于 ${fmt(c.createdAt)} 创建，当前阶段 ${esc(c.stage)}</span></div></li>
            <li><div class="timeline-dot" style="background:var(--primary)"></div><div class="timeline-content"><strong>最近更新</strong><br><span class="text-muted">${fmt(c.updatedAt)} · 阶段: ${esc(c.stage)} · 状态: ${statusLabel[c.status]}</span></div></li>
            ${c.aiExtracted ? '<li><div class="timeline-dot" style="background:var(--cyan)"></div><div class="timeline-content"><strong>AI 提取执行</strong><br><span class="text-muted">已提取 ' + c.aiExtracted.fields.length + ' 个字段，来源文件 ' + esc(c.aiExtracted.sourceFile || '扫描件') + '</span></div></li>' : ''}
          </ul>
        </div>

        <!-- Tab: 财务 -->
        <div id="tab-finance" class="tab-content hidden">
          <div class="grid-2">
            <div class="card" style="background:linear-gradient(135deg,#1a73e8,#1557b0);color:#fff;border:none">
              <div style="font-size:13px;opacity:.85">合同总金额</div>
              <div style="font-size:32px;font-weight:700;margin-top:4px">${fmtMoney(c.amount)}</div>
              <div style="font-size:12px;opacity:.7;margin-top:4px">含 ${c.taxRate}% 增值税</div>
            </div>
            <div class="card" style="background:linear-gradient(135deg,var(--green),#389e0d);color:#fff;border:none">
              <div style="font-size:13px;opacity:.85">待回款金额</div>
              <div style="font-size:32px;font-weight:700;margin-top:4px">${fmtMoney(c.amount * 0.55)}</div>
              <div style="font-size:12px;opacity:.7;margin-top:4px">已付 ${fmtMoney(c.amount * 0.45)} · 质保金 ${fmtMoney(c.amount * 0.05)}</div>
            </div>
          </div>
          <div class="card mt-16">
            <div class="card-title mb-12">付款进度</div>
            <div style="display:flex;align-items:center;gap:16px">
              <div class="progress-bar" style="flex:1;height:12px"><div class="progress-fill" style="width:${progressPercent}%;background:var(--green)"></div></div>
              <span class="text-bold">${progressPercent}%</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12px;color:var(--muted)">
              <span>已履约 ${daysElapsed} 天</span><span>剩余 ${daysRemain} 天</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部信息卡 -->
      <div class="grid-4 mt-16">
        <div class="card" style="text-align:center">
          <div class="stat-label">已履约天数</div>
          <div class="stat-value" style="color:var(--green)">${daysElapsed}</div>
          <div class="stat-desc">天</div>
        </div>
        <div class="card" style="text-align:center">
          <div class="stat-label">剩余天数</div>
          <div class="stat-value" style="color:${daysRemain < 30 ? 'var(--red)' : 'var(--orange)'}">${daysRemain}</div>
          <div class="stat-desc">天</div>
        </div>
        <div class="card" style="text-align:center">
          <div class="stat-label">合同金额</div>
          <div class="stat-value text-primary">${fmtMoney(c.amount)}</div>
          <div class="stat-desc">含税总额</div>
        </div>
        <div class="card" style="text-align:center">
          <div class="stat-label">保证金</div>
          <div class="stat-value">${c.deposit ? fmtMoney(c.deposit) : '无'}</div>
          <div class="stat-desc">金额</div>
        </div>
      </div>
    `;

    initTabs();
  }

  // ---------- AI 提取录入（深化） ----------
  function renderContractUpload() {
    $('pageTitle').textContent = 'AI 智能提取录入';
    $('pageKicker').textContent = 'OCR + NER Extract';

    $('content').innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">AI 智能提取录入</div>
            <div class="card-subtitle">上传合同扫描件 → OCR识别 → AI字段提取 → 人工审核 → AI评审 → 保存台账</div>
          </div>
        </div>

        <!-- 4步向导 -->
        <div class="steps">
          <div class="step active" id="step0"><div class="step-dot">1</div><span class="step-label">上传文件</span></div>
          <div class="step-line"></div>
          <div class="step" id="step1"><div class="step-dot">2</div><span class="step-label">提取审核</span></div>
          <div class="step-line"></div>
          <div class="step" id="step2"><div class="step-dot">3</div><span class="step-label">AI 评审</span></div>
          <div class="step-line"></div>
          <div class="step" id="step3"><div class="step-dot">4</div><span class="step-label">保存台账</span></div>
        </div>

        <!-- Step 0: 上传 -->
        <div id="uploadStep">
          <div class="card mb-16" style="background:#f0f5ff;border:2px dashed var(--primary)">
            <div style="text-align:center;padding:32px">
              <div style="font-size:48px;color:var(--primary);margin-bottom:12px">📂</div>
              <div class="text-bold mb-8">点击或拖拽文件到此处上传</div>
              <div class="text-muted">支持 PDF、JPG、PNG、BMP、TIFF 等格式 · 单文件最大 20MB</div>
              <input type="file" id="fileInput" accept=".pdf,.jpg,.jpeg,.png,.bmp,.tiff" style="margin-top:16px">
            </div>
          </div>
          <div id="uploadFileInfo" class="mb-12 hidden"></div>

          <div style="background:#f5f5f5;padding:14px;border-radius:8px;margin-bottom:16px">
            <div class="text-bold mb-8" style="font-size:13px">📋 AI 提取字段范围（参考）</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              <span class="tag tag-blue">合同编号</span><span class="tag tag-blue">甲方名称</span><span class="tag tag-blue">乙方名称</span>
              <span class="tag tag-blue">签订日期</span><span class="tag tag-blue">合同总金额</span><span class="tag tag-blue">付款条件</span>
              <span class="tag tag-cyan">交付物</span><span class="tag tag-cyan">服务期限</span><span class="tag tag-cyan">验收标准</span>
              <span class="tag tag-cyan">续约条件</span><span class="tag tag-cyan">税率</span><span class="tag tag-cyan">保证金</span>
            </div>
          </div>

          <div style="text-align:center;margin-top:24px">
            <button class="btn btn-primary btn-lg" id="startOCRBtn" onclick="window._startOCR()">📄 开始 OCR 识别与信息提取</button>
          </div>
        </div>

        <!-- Step 1: 提取审核 -->
        <div id="extractStep" class="hidden">
          <div class="card mb-12" style="background:#f5f5f5">
            <div class="card-header" style="border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:10px">
              <div class="card-title" style="font-size:14px">📄 OCR 识别原始文本</div>
              <span class="tag tag-cyan">置信度综合 0.87</span>
            </div>
            <pre id="ocrRawText" style="white-space:pre-wrap;font-size:12px;max-height:220px;overflow:auto;padding:8px"></pre>
          </div>

          <div class="card mb-12">
            <div class="card-title mb-12">✏️ 提取字段 — 人工审核修正</div>
            <p class="text-muted mb-12" style="font-size:13px">AI 提取值作为参考填入"人工修正值"列，请核实后填写。AI 数据与人工数据分开存储。</p>
            <div id="fieldsTable"></div>
          </div>

          <div style="text-align:center">
            <button class="btn btn-outline" onclick="window._uploadStep(0)">← 上一步</button>
            <button class="btn btn-primary" onclick="window._startReview()">下一步：AI 评审 →</button>
          </div>
        </div>

        <!-- Step 2: AI 评审 -->
        <div id="reviewStep" class="hidden">
          <div id="reviewResults"></div>
          <div style="text-align:center;margin-top:24px">
            <button class="btn btn-outline" onclick="window._uploadStep(1)">← 返回修改</button>
            <button class="btn btn-primary" onclick="window._saveToLedger()">✓ 确认并保存至台账</button>
          </div>
        </div>

        <!-- Step 3: 完成 -->
        <div id="doneStep" class="hidden" style="text-align:center;padding:60px 0">
          <div style="font-size:64px;color:var(--green);margin-bottom:16px">✅</div>
          <h3>合同录入完成</h3>
          <p class="text-muted" style="margin-top:8px">AI 提取数据与人工修正数据已分开存储，等待后续审核流程。</p>
          <p class="text-muted" style="font-size:13px;margin-top:4px">合同编号：<span id="savedCode" class="text-bold"></span></p>
          <div style="margin-top:20px">
            <button class="btn btn-primary" data-nav="contract">查看合同列表</button>
            <button class="btn btn-outline ml-8" onclick="window._uploadStep(0);window._resetUpload()">继续录入</button>
          </div>
        </div>
      </div>
    `;

    window._ocrResult = null;
    window._editedFields = {};

    const fileInput = $('fileInput');
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        $('uploadFileInfo').innerHTML = '<span class="tag tag-blue">📄 ' + esc(file.name) + '</span> <span class="text-muted">' + (file.size / 1024).toFixed(0) + ' KB</span>';
        $('uploadFileInfo').classList.remove('hidden');
      }
    };
  }

  // ---------- 合同评审（深化） ----------
  function renderContractReview() {
    const pendingReviews = [
      { id: 'rev-1', code: 'HT-2024-005', partyA: '南京紫峰软件有限公司', amount: 1560000, subject: 'ERP系统迁移与数据整理服务', stage: 'S4_确认', submittedAt: fmtDateTime(dAgo(2)), reviewer: '法务/技术联合评审' },
      { id: 'rev-2', code: 'HT-2024-006', partyA: '武汉长江数据科技', amount: 890000, subject: '数据可视化平台二次开发', stage: 'S5_签订', submittedAt: fmtDateTime(dAgo(1)), reviewer: '法务评审' },
      { id: 'rev-3', code: 'HT-2024-007', partyA: '厦门海天信息技术', amount: 2300000, subject: '智慧港口物联网平台建设', stage: 'S4_确认', submittedAt: fmtDateTime(dAgo(0)), reviewer: '技术评审' },
    ];

    $('pageTitle').textContent = '合同评审';
    $('pageKicker').textContent = 'Contract Review';

    $('content').innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">待评审</div><div class="stat-value" style="color:var(--orange)">${pendingReviews.length}</div><div class="stat-desc">本批次</div></div>
        <div class="stat-card"><div class="stat-label">已评审</div><div class="stat-value text-green">12</div><div class="stat-desc">本月</div></div>
        <div class="stat-card"><div class="stat-label">已驳回</div><div class="stat-value" style="color:var(--red)">2</div><div class="stat-desc">需修改</div></div>
      </div>

      <div class="card">
        <div class="tabs" data-tab-group="review">
          <button class="tab-btn active" data-tab="review-list">📋 待评审列表</button>
          <button class="tab-btn" data-tab="review-detail">🔍 评审结果</button>
        </div>

        <div id="tab-review-list" class="tab-content">
          <div class="table-wrap">
            <table>
              <thead><tr><th>编号</th><th>甲方</th><th>标的物</th><th>金额</th><th>阶段</th><th>提交日期</th><th>评审类型</th><th>操作</th></tr></thead>
              <tbody>
                ${pendingReviews.map(r => `<tr>
                  <td class="text-bold text-primary">${esc(r.code)}</td>
                  <td>${esc(r.partyA)}</td>
                  <td>${esc(r.subject)}</td>
                  <td class="text-bold">${fmtMoney(r.amount)}</td>
                  <td><span class="tag tag-blue">${esc(r.stage)}</span></td>
                  <td>${r.submittedAt}</td>
                  <td><span class="tag tag-cyan">${esc(r.reviewer)}</span></td>
                  <td>
                    <button class="btn btn-primary btn-sm" onclick="window._runReview('${r.id}')">⚡ AI 评审</button>
                  </td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div id="tab-review-detail" class="tab-content hidden">
          <div id="reviewDetailContent">
            <div class="empty">
              <div class="empty-icon">🔍</div>
              <p>请从"待评审列表"选择一项合同，点击"AI 评审"查看结果。</p>
              <p class="text-muted" style="font-size:12px;margin-top:4px">评审将自动执行：法务预审（敏感词检测）→ 合规性检查（法规比对）→ 历史对比（价格/条款差异提醒）</p>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ---------- 风险提醒（深化） ----------
  function renderRiskAlerts() {
    $('pageTitle').textContent = '风险提醒看板';
    $('pageKicker').textContent = 'Risk Alerts';

    const unresolved = state.alerts.filter(a => !a.resolved);
    const high = unresolved.filter(a => a.level === 'high');
    const medium = unresolved.filter(a => a.level === 'medium');
    const low = unresolved.filter(a => a.level === 'low');
    const levelTag = { 'high': 'tag-red', 'medium': 'tag-orange', 'low': 'tag-cyan' };
    const levelLabel = { 'high': '高', 'medium': '中', 'low': '低' };
    const levelBg = { 'high': '#fff1f0', 'medium': '#fffbe6', 'low': '#e6fffb' };

    $('content').innerHTML = `
      <!-- 统计 -->
      <div class="stat-grid">
        <div class="stat-card" style="border-left:4px solid var(--red)">
          <div class="stat-label text-red">高风险</div>
          <div class="stat-value text-red">${high.length}</div>
          <div class="stat-desc">需立即处理</div>
        </div>
        <div class="stat-card" style="border-left:4px solid var(--orange)">
          <div class="stat-label" style="color:var(--orange)">中风险</div>
          <div class="stat-value" style="color:var(--orange)">${medium.length}</div>
          <div class="stat-desc">需关注</div>
        </div>
        <div class="stat-card" style="border-left:4px solid var(--cyan)">
          <div class="stat-label" style="color:var(--cyan)">低风险</div>
          <div class="stat-value" style="color:var(--cyan)">${low.length}</div>
          <div class="stat-desc">例行提醒</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">已处理</div>
          <div class="stat-value text-green">${state.alerts.filter(a => a.resolved).length}</div>
          <div class="stat-desc">条</div>
        </div>
      </div>

      <!-- 风险条目 -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">⚠️ 风险提醒详情</div>
          <div>
            <button class="btn btn-outline btn-sm" onclick="window._refreshAlerts()">🔄 刷新</button>
            <button class="btn btn-outline btn-sm" onclick="window._markAllResolved()">✓ 批量处理</button>
          </div>
        </div>
        <div style="display:grid;gap:12px">
          ${state.alerts.map(a => `
            <div class="risk-card ${a.level}" style="border-radius:8px;padding:16px;border-left:4px solid ${a.level === 'high' ? 'var(--red)' : a.level === 'medium' ? 'var(--orange)' : 'var(--cyan)'};background:${levelBg[a.level]};${a.resolved ? 'opacity:.6' : ''}">
              <div style="display:flex;justify-content:space-between;align-items:start;gap:12px">
                <div style="flex:1">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                    <span class="tag ${levelTag[a.level]}">${levelLabel[a.level]}风险</span>
                    <span class="text-bold">${esc(a.contractCode)}</span>
                    <span class="tag tag-default">${esc(a.type)}</span>
                    ${a.resolved ? '<span class="tag tag-green">已处理</span>' : ''}
                  </div>
                  <div style="font-size:14px;margin:6px 0">${esc(a.content)}</div>
                  ${a.suggestion ? '<div style="font-size:13px;color:var(--primary);margin-top:4px">💡 建议：' + esc(a.suggestion) + '</div>' : ''}
                  ${a.historyRef ? '<div style="font-size:12px;color:var(--muted);margin-top:6px;padding:6px 10px;background:rgba(0,0,0,.03);border-radius:4px">📚 历史借鉴：' + esc(a.historyRef) + '</div>' : ''}
                </div>
                <div style="text-align:right;flex-shrink:0">
                  <div class="text-muted" style="font-size:11px">${fmtDateTime(a.createdAt)}</div>
                  ${!a.resolved ? `<button class="btn btn-success btn-sm mt-8" onclick="window._resolveAlert('${a.id}')">✓ 处理</button>` : ''}
                </div>
              </div>
            </div>
          `).join('')}
          ${!state.alerts.length ? '<div class="empty" style="padding:40px"><div class="empty-icon">✅</div><p>暂无风险提醒，合同状态良好</p></div>' : ''}
        </div>
      </div>
    `;
  }

  // ---------- 台账管理（深化） ----------
  function renderLedger() {
    $('pageTitle').textContent = '合同台账';
    $('pageKicker').textContent = 'Ledger';

    const contracts = state.contracts;
    const total = contracts.reduce((s, c) => s + c.amount, 0);
    const totalTax = contracts.reduce((s, c) => s + c.amount * c.taxRate / 100, 0);
    const totalDeposit = contracts.reduce((s, c) => s + c.deposit, 0);
    const activeCount = contracts.filter(c => c.status === 'active').length;

    $('content').innerHTML = `
      <!-- 财务概览 -->
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">合同总数</div><div class="stat-value">${contracts.length}</div><div class="stat-desc">份</div></div>
        <div class="stat-card"><div class="stat-label">签约总额</div><div class="stat-value text-primary">${Math.round(total / 10000)}<small style="font-size:16px"> 万元</small></div><div class="stat-desc">含税额</div></div>
        <div class="stat-card"><div class="stat-label">税额合计</div><div class="stat-value" style="color:var(--orange)">${Math.round(totalTax / 10000)}<small style="font-size:16px"> 万元</small></div><div class="stat-desc">增值税</div></div>
        <div class="stat-card"><div class="stat-label">质保金</div><div class="stat-value">${Math.round(totalDeposit / 10000)}<small style="font-size:16px"> 万元</small></div><div class="stat-desc">${totalDeposit ? (totalDeposit / total * 100).toFixed(1) + '%' : '0%'} 占比</div></div>
        <div class="stat-card"><div class="stat-label">履约中</div><div class="stat-value text-green">${activeCount}</div><div class="stat-desc">份</div></div>
        <div class="stat-card"><div class="stat-label">已完成</div><div class="stat-value">${contracts.filter(c => c.status === 'completed').length}</div><div class="stat-desc">份</div></div>
      </div>

      <!-- 台账表格 -->
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">📒 合同台账明细</div>
            <div class="card-subtitle">全量合同记录 · 可筛选导出</div>
          </div>
          <button class="btn btn-outline btn-sm" onclick="window._batchExport()">📥 导出台账</button>
        </div>

        <div class="form-grid mb-16" style="background:#fafbfc;padding:14px;border-radius:8px">
          <div class="form-group"><div class="form-label">搜索</div><input class="form-input" id="ledgerSearch" placeholder="编号/甲方/标的物" oninput="window._ledgerFilter()"></div>
          <div class="form-group"><div class="form-label">阶段</div><select class="form-input" id="ledgerStage" onchange="window._ledgerFilter()"><option value="">全部</option><option value="S4_确认">S4</option><option value="S5_签订">S5</option><option value="S6_履约">S6</option><option value="completed">已完成</option></select></div>
          <div class="form-group"><div class="form-label">状态</div><select class="form-input" id="ledgerStatus" onchange="window._ledgerFilter()"><option value="">全部</option><option value="active">履约中</option><option value="pending">待处理</option><option value="risk">风险</option><option value="completed">已完成</option></select></div>
          <div class="form-group"><div class="form-label">部门</div><select class="form-input" id="ledgerDept" onchange="window._ledgerFilter()"><option value="">全部</option><option value="销售部">销售部</option><option value="技术部">技术部</option><option value="客户二部">客户二部</option></select></div>
        </div>

        <div id="ledgerTable"></div>
      </div>
    `;
    renderLedgerTable(contracts);
  }

  function renderLedgerTable(data) {
    const d = data || state.contracts;
    const stageColor = { 'S4_确认': 'tag-blue', 'S5_签订': 'tag-orange', 'S6_履约': 'tag-green', 'completed': 'tag-default' };
    const statusColor = { 'active': 'tag-green', 'pending': 'tag-blue', 'completed': 'tag-default', 'risk': 'tag-red' };
    const statusLabel = { 'active': '履约中', 'pending': '待处理', 'completed': '已完成', 'risk': '风险' };

    $('ledgerTable').innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>编号</th><th>甲方</th><th>标的物</th><th>总金额</th><th>税率</th><th>签订日期</th><th>生效日期</th><th>到期日期</th><th>阶段</th><th>经办部门</th><th>经办人</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            ${d.map(c => `<tr>
              <td class="text-bold text-primary" style="cursor:pointer" data-nav="contract-${c.id}">${esc(c.code)}</td>
              <td>${esc(c.partyA)}</td>
              <td>${esc(c.subject)}</td>
              <td class="text-bold">${fmtMoney(c.amount)}</td>
              <td>${c.taxRate}%</td>
              <td>${fmt(c.signDate)}</td>
              <td>${fmt(c.effectiveDate)}</td>
              <td>${fmt(c.expireDate)}</td>
              <td><span class="tag ${stageColor[c.stage]}">${esc(c.stage)}</span></td>
              <td>${esc(c.dept)}</td>
              <td>${esc(c.handler)}</td>
              <td><span class="tag ${statusColor[c.status]}">${statusLabel[c.status]}</span></td>
              <td><button class="btn btn-ghost btn-sm" data-nav="contract-${c.id}">查看</button></td>
            </tr>`).join('')}
            ${!d.length ? '<tr><td colspan="13" style="text-align:center;padding:40px;color:var(--muted)">暂无数据</td></tr>' : ''}
          </tbody>
        </table>
      </div>
      <div class="mt-12" style="display:flex;justify-content:space-between;align-items:center">
        <span class="text-muted">共 ${d.length} 条${d.length !== state.contracts.length ? '（筛选结果）' : ''}</span>
        <span class="text-muted">筛选总额：${fmtMoney(d.reduce((s, c) => s + c.amount, 0))}</span>
      </div>
    `;
  }

  // ---------- 文档管理（深化） ----------
  function renderKnowledge() {
    $('pageTitle').textContent = '知识库 - 文档管理';
    $('pageKicker').textContent = 'Knowledge Base';

    const docs = state.knowledgeDocs;
    const totalSize = docs.reduce((s, d) => s + d.size, 0);

    $('content').innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">文档总数</div><div class="stat-value">${docs.length}</div><div class="stat-desc">份</div></div>
        <div class="stat-card"><div class="stat-label">总容量</div><div class="stat-value">${(totalSize / 1024 / 1024).toFixed(1)}<small style="font-size:14px"> MB</small></div><div class="stat-desc">已用</div></div>
        <div class="stat-card"><div class="stat-label">本周更新</div><div class="stat-value">${docs.filter(d => daysDiff(new Date(d.updatedAt), new Date()) < 7 && daysDiff(new Date(d.updatedAt), new Date()) >= 0).length}</div><div class="stat-desc">份</div></div>
        <div class="stat-card"><div class="stat-label">待审核</div><div class="stat-value" style="color:var(--orange)">1</div><div class="stat-desc">份</div></div>
      </div>

      <div class="card">
        <div class="btn-row mb-12">
          <input class="form-input" id="kbSearch" placeholder="搜索文档名称/标签..." style="width:280px" oninput="window._filterDocs()">
          <select class="form-input" id="kbTypeFilter" style="width:120px" onchange="window._filterDocs()">
            <option value="">全部类型</option><option value="md">Markdown</option><option value="pdf">PDF</option>
          </select>
          <button class="btn btn-outline btn-sm" onclick="window._batchAction('reindex')">🔄 批量重新索引</button>
          <button class="btn btn-outline btn-sm" onclick="window._batchAction('sync')">🔄 同步 Dify</button>
          <div style="flex:1"></div>
          <button class="btn btn-primary" onclick="document.getElementById('kbFileInput').click()">📤 上传文档</button>
          <input type="file" id="kbFileInput" accept=".md,.pdf,.doc,.docx,.txt" style="display:none" onchange="window._uploadDoc(this)">
        </div>

        <div id="docGrid" class="grid-3">
          ${docs.map(d => `
            <div class="card doc-card" data-tags="${esc((d.tags || []).join(','))}" data-title="${esc(d.title.toLowerCase())}" data-type="${d.fileType}" style="cursor:pointer" onclick="window._viewDoc('${d.id}')">
              <div style="display:flex;justify-content:space-between;align-items:start">
                <div style="font-size:32px;color:var(--primary)">${d.fileType === 'pdf' ? '📕' : d.fileType === 'md' ? '📝' : '📄'}</div>
                <span class="tag ${d.fileType === 'pdf' ? 'tag-red' : d.fileType === 'md' ? 'tag-blue' : 'tag-default'}">${d.fileType.toUpperCase()}</span>
              </div>
              <div class="text-bold mt-8" style="font-size:14px">${esc(d.title)}</div>
              <div class="text-muted" style="font-size:12px;margin-top:4px;line-height:1.5">${esc(d.description).slice(0, 60)}</div>
              <div class="btn-row mt-8">
                ${(d.tags || []).map(t => '<span class="tag tag-cyan">' + esc(t) + '</span>').join(' ')}
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid var(--line)">
                <span class="text-muted" style="font-size:11px">v${d.versions[0].version} · ${fmt(d.updatedAt)}</span>
                <span class="text-muted" style="font-size:11px">${(d.size / 1024).toFixed(0)} KB</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderDocDetail(id) {
    const d = state.knowledgeDocs.find(x => x.id === id);
    if (!d) { toast('文档未找到'); return; }

    $('pageTitle').textContent = d.title;
    $('pageKicker').textContent = d.fileType.toUpperCase();

    $('content').innerHTML = `
      <button class="btn btn-outline btn-sm mb-16" data-nav="knowledge">← 返回文档库</button>

      <div class="grid-2-1">
        <div>
          <div class="card mb-16">
            <div class="card-title mb-12">📄 文档信息</div>
            <table class="kv-table">
              <tr><td class="kv-label">标题</td><td class="text-bold">${esc(d.title)}</td></tr>
              <tr><td class="kv-label">文件名</td><td>${esc(d.filename)}</td></tr>
              <tr><td class="kv-label">类型</td><td><span class="tag ${d.fileType === 'pdf' ? 'tag-red' : d.fileType === 'md' ? 'tag-blue' : 'tag-default'}">${d.fileType.toUpperCase()}</span></td></tr>
              <tr><td class="kv-label">大小</td><td>${d.size > 1048576 ? (d.size / 1048576).toFixed(1) + ' MB' : (d.size / 1024).toFixed(0) + ' KB'}</td></tr>
              <tr><td class="kv-label">所属文件夹</td><td>${esc(d.folder)}</td></tr>
              <tr><td class="kv-label">作者</td><td>${esc(d.versions[0].author)}</td></tr>
              <tr><td class="kv-label">更新时间</td><td>${fmt(d.updatedAt)}</td></tr>
              <tr><td class="kv-label">关联软件</td><td>${esc(d.linkedSoftware || '—')}</td></tr>
              <tr><td class="kv-label">权限</td><td>${d.permissions.public ? '公开' : d.permissions.roles.join(', ')}</td></tr>
            </table>
          </div>

          <div class="card">
            <div class="card-title mb-12">📜 版本历史</div>
            <ul class="timeline">
              ${d.versions.map((v, i) => `<li>
                <div class="timeline-dot" style="background:${i === 0 ? 'var(--green)' : 'var(--muted)'}"></div>
                <div class="timeline-content">
                  <strong>v${esc(v.version)}</strong> <span class="tag tag-default">${esc(v.filename)}</span>
                  <br><span class="text-muted" style="font-size:12px">${fmt(v.updatedAt)} · ${esc(v.author)} · ${v.size > 1048576 ? (v.size / 1048576).toFixed(1) + ' MB' : (v.size / 1024).toFixed(0) + ' KB'}
                  ${v.changelog ? '<br>变更：' + esc(v.changelog) : ''}</span>
                </div>
              </li>`).join('')}
            </ul>
          </div>
        </div>

        <div>
          <div class="card mb-16">
            <div class="card-title mb-8">🏷️ 标签</div>
            <div>${(d.tags || []).map(t => '<span class="tag tag-cyan">' + esc(t) + '</span>').join(' ')}</div>
          </div>

          ${d.summary ? '<div class="card mb-16"><div class="card-title mb-8">🤖 AI 生成摘要</div><p style="font-size:13px;line-height:1.8">' + esc(d.summary) + '</p><div class="text-muted" style="font-size:11px;margin-top:6px">由 AI 于 ' + fmt(d.updatedAt) + ' 自动生成 · 用于后续检索与维护</div></div>' : ''}

          <div class="card mb-16">
            <div class="card-title mb-8">🔐 权限设置</div>
            <div style="display:grid;gap:8px;font-size:13px">
              <div>访问权限：<span class="text-bold">${d.permissions.public ? '公开（所有人可见）' : d.permissions.roles.join(', ')}</span></div>
              <div>编辑权限：<span class="text-bold">${d.permissions.roles.includes('admin') ? '管理员' : '指定角色'}</span></div>
              <div>下载权限：<span class="text-bold">${d.permissions.public ? '允许下载' : '仅授权角色'}</span></div>
            </div>
          </div>

          <div class="card">
            <div class="card-title mb-8">📊 文档统计</div>
            <div class="stat-grid" style="grid-template-columns:1fr 1fr">
              <div class="stat-card" style="cursor:default"><div class="stat-label">版本数</div><div class="stat-value">${d.versions.length}</div></div>
              <div class="stat-card" style="cursor:default"><div class="stat-label">标签数</div><div class="stat-value">${(d.tags || []).length}</div></div>
              <div class="stat-card" style="cursor:default"><div class="stat-label">文件大小</div><div class="stat-value" style="font-size:20px">${d.size > 1048576 ? (d.size / 1048576).toFixed(1) + 'MB' : (d.size / 1024).toFixed(0) + 'KB'}</div></div>
              <div class="stat-card" style="cursor:default"><div class="stat-label">更新频率</div><div class="stat-value" style="font-size:20px">${daysDiff(new Date(d.versions[1]?.updatedAt || d.createdAt), new Date(d.updatedAt))}天</div></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ---------- OA 数据同步（深化） ----------
  function renderOASync() {
    const configs = state.oaConfigs;
    const platLabel = { yonyou: '用友', jd: '金蝶', custom: '自定义' };
    const platColor = { yonyou: 'tag-blue', jd: 'tag-orange', custom: 'tag-green' };
    const syncLabel = { realtime: '实时同步', daily: '每日同步', manual: '手动同步' };

    $('pageTitle').textContent = 'OA 数据同步';
    $('pageKicker').textContent = 'OA Sync';

    $('content').innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">同步配置</div><div class="stat-value">${configs.length}</div><div class="stat-desc">个平台</div></div>
        <div class="stat-card"><div class="stat-label">已启用</div><div class="stat-value text-green">${configs.filter(c => c.enabled).length}</div><div class="stat-desc">运行中</div></div>
        <div class="stat-card"><div class="stat-label">字段映射</div><div class="stat-value">${configs.reduce((s, c) => s + c.fieldMappings.length, 0)}</div><div class="stat-desc">条规则</div></div>
        <div class="stat-card"><div class="stat-label">最近同步</div><div class="stat-value text-muted">${configs.find(c => c.lastSyncAt) ? fmtDateTime(configs.find(c => c.lastSyncAt).lastSyncAt) : '—'}</div><div class="stat-desc">${configs.find(c => c.lastSyncStatus) ? (configs.find(c => c.lastSyncStatus).lastSyncStatus === 'success' ? '成功' : '未同步') : ''}</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">🔄 同步配置管理</div>
          <button class="btn btn-primary btn-sm" onclick="toast('演示：配置创建向导已打开')">+ 添加配置</button>
        </div>

        <div class="table-wrap">
          <table>
            <thead><tr><th>平台</th><th>启用</th><th>同步方式</th><th>接口地址</th><th>字段映射</th><th>鉴权状态</th><th>最近同步</th><th>操作</th></tr></thead>
            <tbody>
              ${configs.map(c => `<tr>
                <td><span class="tag ${platColor[c.platform]}">${platLabel[c.platform]}</span></td>
                <td><span class="tag ${c.enabled ? 'tag-green' : 'tag-default'}">${c.enabled ? '已启用' : '已禁用'}</span></td>
                <td>${syncLabel[c.syncType]}</td>
                <td><code style="font-size:11px">${esc(c.endpoint)}</code></td>
                <td>${c.fieldMappings.length} 条</td>
                <td>${c.apiKey ? '<span class="tag tag-green">已配置</span>' : '<span class="tag tag-red">未配置</span>'}</td>
                <td><div>${c.lastSyncAt ? fmtDateTime(c.lastSyncAt) : '从未同步'}</div><div style="font-size:11px;margin-top:2px">${c.lastSyncStatus === 'success' ? '<span class="tag tag-green" style="font-size:11px">成功</span>' : c.lastSyncStatus === 'failed' ? '<span class="tag tag-red" style="font-size:11px">失败</span>' : ''}</div></td>
                <td>
                  <button class="btn btn-primary btn-sm" onclick="window._triggerSync('${c.id}')" ${!c.enabled ? 'disabled' : ''}>🔄 同步</button>
                  <button class="btn btn-ghost btn-sm" onclick="toast('演示：配置编辑')">配置</button>
                  <button class="btn btn-ghost btn-sm" onclick="window._deleteOaConfig('${c.id}')" style="color:var(--red)">删除</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- 字段映射详情 -->
      <div class="card mt-16">
        <div class="card-title mb-12">📐 字段映射规则</div>
        ${configs.map(c => c.fieldMappings.length ? `<div class="mb-16">
          <div class="text-bold mb-8">${platLabel[c.platform]} · ${c.fieldMappings.length} 条映射</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>本地字段</th><th>远程字段</th><th>转换规则</th><th>方向</th></tr></thead>
              <tbody>
                ${c.fieldMappings.map(m => `<tr>
                  <td><code style="font-size:12px">${esc(m.local)}</code></td>
                  <td><code style="font-size:12px">${esc(m.remote)}</code></td>
                  <td>${m.transform ? '<span class="tag tag-cyan">' + esc(m.transform) + '</span>' : '<span class="text-muted">直接映射</span>'}</td>
                  <td><span class="tag tag-blue">双向</span></td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>` : '<div class="text-muted" style="text-align:center;padding:20px">该平台暂无字段映射配置</div>').join('')}
      </div>

      <!-- 同步日志 -->
      <div class="card mt-16">
        <div class="card-title mb-12">📋 同步日志</div>
        <div class="timeline">
          <li><div class="timeline-dot" style="background:var(--green)"></div><div class="timeline-content"><strong>${platLabel[configs[0]?.platform] || '系统'}</strong> · 同步成功<br><span class="text-muted" style="font-size:12px">${configs[0]?.lastSyncAt ? fmtDateTime(configs[0].lastSyncAt) : '—'} · 4 条字段映射成功</span></div></li>
          <li><div class="timeline-dot" style="background:var(--orange)"></div><div class="timeline-content"><strong>${platLabel[configs[0]?.platform] || '系统'}</strong> · 部分失败<br><span class="text-muted" style="font-size:12px">昨日 02:00 · 1 条字段格式不匹配</span></div></li>
        </div>
      </div>
    `;
  }

  // ---------- 系统设置（深化） ----------
  function renderSettings() {
    $('pageTitle').textContent = '系统设置';
    $('pageKicker').textContent = 'Settings';

    $('content').innerHTML = `
      <div class="grid-3">
        <!-- 用户管理 -->
        <div class="card">
          <div class="card-title mb-12">👤 用户信息</div>
          <div class="form-group"><div class="form-label">用户名</div><input class="form-input" value="${esc(state.user.name)}" id="setUsername"></div>
          <div class="form-group"><div class="form-label">角色</div><input class="form-input" value="管理员" disabled></div>
          <div class="form-group"><div class="form-label">所属部门</div><input class="form-input" value="技术部" disabled></div>
          <button class="btn btn-primary" style="width:100%" onclick="toast('用户信息已更新')">保存修改</button>
          <hr class="divider">
          <div class="text-bold mb-8">角色切换（演示）</div>
          <div style="display:grid;gap:6px">
            <button class="btn btn-outline btn-sm" onclick="window._switchRole('admin')">管理员</button>
            <button class="btn btn-outline btn-sm" onclick="window._switchRole('manager')">项目经理</button>
            <button class="btn btn-outline btn-sm" onclick="window._switchRole('user')">普通用户</button>
          </div>
        </div>

        <!-- AI 功能配置 -->
        <div class="card">
          <div class="card-title mb-12">🧠 AI 功能配置</div>
          <div class="form-group"><label class="form-label"><input type="checkbox" checked> 启用 OCR 文档识别</label></div>
          <div class="form-group"><label class="form-label"><input type="checkbox" checked> 启用合同字段提取</label></div>
          <div class="form-group"><label class="form-label"><input type="checkbox" checked> 启用法务敏感词检测</label></div>
          <div class="form-group"><label class="form-label"><input type="checkbox" checked> 启用合规性比对</label></div>
          <div class="form-group"><label class="form-label"><input type="checkbox" checked> 启用历史价格对比</label></div>
          <div class="form-group"><label class="form-label"><input type="checkbox"> 启用代码自动扫描</label></div>
          <div class="form-group"><label class="form-label"><input type="checkbox" checked> 启用主动风险提醒</label></div>
          <div class="form-group"><label class="form-label"><input type="checkbox"> 自动 OA 数据同步</label></div>
          <button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="toast('AI 配置已保存')">保存 AI 配置</button>
        </div>

        <!-- 系统信息 -->
        <div class="card">
          <div class="card-title mb-12">ℹ️ 系统信息</div>
          <div style="font-size:13px;line-height:2.2">
            <div>系统版本：<code>v2.1.0</code></div>
            <div>前端框架：<code>Vanilla JS + CSS3</code></div>
            <div>后端框架：<code>Python FastAPI</code></div>
            <div>端口：<code>8011</code></div>
            <div>AI 引擎：<code>前端模拟层（可替换为真实 API）</code></div>
            <div>数据库：<code>Mock 数据（需接入后端）</code></div>
            <div>上线时间：<code>2024-06-16</code></div>
          </div>
          <hr class="divider">
          <div class="text-bold mb-8">系统操作</div>
          <div style="display:grid;gap:6px">
            <button class="btn btn-outline btn-sm" onclick="toast('缓存已清理')">🧹 清理缓存</button>
            <button class="btn btn-outline btn-sm" onclick="toast('日志已导出')">📥 导出系统日志</button>
            <button class="btn btn-outline btn-sm" onclick="toast('数据备份完成')">💾 数据备份</button>
          </div>
        </div>
      </div>

      <!-- AI 模拟说明 -->
      <div class="card mt-16">
        <div class="card-title mb-12">🧠 AI 模拟层说明与生产接入指南</div>
        <div class="grid-2">
          <div>
            <div class="text-bold mb-8">当前模拟能力</div>
            <table class="kv-table" style="font-size:13px">
              <tr><td class="kv-label">OCR 识别</td><td>上传文件后延迟 1.8s 返回模拟文本</td></tr>
              <tr><td class="kv-label">NER 字段提取</td><td>正则匹配 + 预设映射生成 8+ 字段</td></tr>
              <tr><td class="kv-label">法务预审</td><td>敏感词库检测（10 条规则）</td></tr>
              <tr><td class="kv-label">合规性检查</td><td>模拟返回 5 条法规比对结果</td></tr>
              <tr><td class="kv-label">历史对比</td><td>价格/条款/标的物差异提醒</td></tr>
              <tr><td class="kv-label">文档摘要</td><td>关键词提取 + 模板生成摘要</td></tr>
              <tr><td class="kv-label">OA 同步</td><td>模拟操作结果 + 日志</td></tr>
            </table>
          </div>
          <div>
            <div class="text-bold mb-8">生产环境接入要点</div>
            <table class="kv-table" style="font-size:13px">
              <tr><td class="kv-label">OCR</td><td>百度/阿里云 OCR API 或 PaddleOCR</td></tr>
              <tr><td class="kv-label">NER</td><td>LLM 大模型（通义千问/Claude）</td></tr>
              <tr><td class="kv-label">法规库</td><td>内部法务知识库 API 或外部法规平台</td></tr>
              <tr><td class="kv-label">代码扫描</td><td>SonarQube / CodeGeeX 等 SAST 工具</td></tr>
              <tr><td class="kv-label">摘要生成</td><td>Embedding + RAG 检索增强</td></tr>
              <tr><td class="kv-label">OA 同步</td><td>金蝶/用友对外接口授权 + 鉴权</td></tr>
              <tr><td class="kv-label">数据存储</td><td>AI 数据与人工数据分表存储</td></tr>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  // ==================== 全局动作 ====================

  // 合同阶段推进
  window._advanceStage = function (id, stage) {
    const c = state.contracts.find(x => x.id === id);
    if (!c) return;
    c.stage = stage;
    if (stage === 'completed') c.status = 'completed';
    else if (stage === 'S6_履约') c.status = 'active';
    else if (stage === 'S5_签订') c.status = 'pending';
    c.updatedAt = fmt(new Date());
    toast('合同 ' + c.code + ' 已推进至 ' + stage, 'success');
    renderContractDetail(id);
  };

  window._setStage = function (id) {
    const stages = ['S4_确认', 'S5_签订', 'S6_履约', 'completed'];
    const cur = state.contracts.find(x => x.id === id);
    const curIdx = stages.indexOf(cur ? cur.stage : 'S4_确认');
    const next = stages[(curIdx + 1) % stages.length];
    showModal('推进合同阶段', '<p>将合同 <strong>' + esc(cur ? cur.code : id) + '</strong> 推进至下一阶段：<strong>' + esc(next) + '</strong></p><div class="alert alert-info mt-12">推进后合同状态将自动更新，相关风险提醒将同步重新计算。</div>',
      '<button class="btn btn-outline" onclick="hideModal()">取消</button><button class="btn btn-primary" onclick="window._advanceStage(\'' + id + '\', \'' + next + '\'); hideModal();">确认推进</button>');
  };

  // 新建合同
  window._newContract = function () {
    showModal('新建合同', `
      <div class="form-grid">
        <div class="form-group"><div class="form-label">合同编号 *</div><input class="form-input" id="m_code" value="HT-2024-${String(state.contracts.length + 1).padStart(3, '0')}"></div>
        <div class="form-group"><div class="form-label">甲方名称 *</div><input class="form-input" id="m_partyA"></div>
        <div class="form-group"><div class="form-label">乙方名称</div><input class="form-input" id="m_partyB" value="上海月明信息系统有限公司"></div>
        <div class="form-group"><div class="form-label">合同总金额 *</div><input class="form-input" id="m_amount" type="number" placeholder="0"></div>
        <div class="form-group"><div class="form-label">合同标的物</div><input class="form-input" id="m_subject"></div>
        <div class="form-group"><div class="form-label">经办人</div><input class="form-input" id="m_handler" value="${esc(state.user.name)}"></div>
        <div class="form-group full"><div class="form-label">付款条件</div><input class="form-input" id="m_payment" placeholder="如：签约30%，验收60%，质保金10%"></div>
        <div class="form-group full"><div class="form-label">交付物</div><input class="form-input" id="m_deliverables"></div>
        <div class="form-group full"><div class="form-label">验收标准</div><input class="form-input" id="m_acceptance"></div>
        <div class="form-group"><div class="form-label">服务期限</div><input class="form-input" id="m_service" placeholder="如：12个月质保期"></div>
        <div class="form-group"><div class="form-label">续约条件</div><input class="form-input" id="m_renewal"></div>
      </div>
    `, '<button class="btn btn-outline" onclick="hideModal()">取消</button><button class="btn btn-primary" onclick="window._saveNewContract()">保存合同</button>');
  };

  window._saveNewContract = function () {
    const code = $('m_code')?.value;
    const partyA = $('m_partyA')?.value;
    const amount = parseFloat($('m_amount')?.value || 0);
    if (!code || !partyA) { toast('请填写合同编号和甲方名称', 'warning'); return; }
    const c = {
      id: 'c-' + Date.now(), code, partyA,
      partyB: $('m_partyB')?.value || '上海月明信息系统有限公司',
      signDate: fmt(new Date()), effectiveDate: fmt(new Date()),
      expireDate: fmt(dLater(365)), dept: '待分配',
      handler: $('m_handler')?.value || state.user.name, amount,
      subject: $('m_subject')?.value || '', unitPrice: 0, taxRate: 13,
      paymentTerms: $('m_payment')?.value || '', deposit: 0,
      deliverables: $('m_deliverables')?.value || '',
      acceptanceStandard: $('m_acceptance')?.value || '',
      servicePeriod: $('m_service')?.value || '',
      renewalConditions: $('m_renewal')?.value || '',
      stage: 'S4_确认', status: 'pending',
      createdAt: fmt(new Date()), updatedAt: fmt(new Date()),
    };
    state.contracts.unshift(c);
    hideModal();
    toast('新合同已创建：' + code, 'success');
    AI.generateAlerts(state.contracts).then(a => state.alerts = a);
    renderContractList();
  };

  // 筛选
  window._filterContracts = function () {
    const kw = ($('searchKw')?.value || '').toLowerCase();
    const status = $('filterStatus')?.value;
    const stage = $('filterStage')?.value;
    const dept = $('filterDept')?.value;
    let data = state.contracts;
    if (kw) data = data.filter(c => [c.code, c.partyA, c.subject, c.handler].some(v => String(v).toLowerCase().includes(kw)));
    if (status) data = data.filter(c => c.status === status);
    if (stage) data = data.filter(c => c.stage === stage);
    if (dept) data = data.filter(c => c.dept === dept);
    renderContractTable(data);
  };

  window._ledgerFilter = function () {
    const kw = ($('ledgerSearch')?.value || '').toLowerCase();
    const stage = $('ledgerStage')?.value;
    const status = $('ledgerStatus')?.value;
    const dept = $('ledgerDept')?.value;
    let data = state.contracts;
    if (kw) data = data.filter(c => [c.code, c.partyA, c.subject].some(v => String(v).toLowerCase().includes(kw)));
    if (stage) data = data.filter(c => c.stage === stage);
    if (status) data = data.filter(c => c.status === status);
    if (dept) data = data.filter(c => c.dept === dept);
    renderLedgerTable(data);
  };

  window._batchExport = function () {
    toast('台账导出功能（演示）：将导出当前筛选结果为 CSV 文件', 'info');
  };

  // 风险提醒
  window._resolveAlert = function (id) {
    const a = state.alerts.find(x => x.id === id);
    if (a) { a.resolved = true; toast('风险提醒已标记为处理', 'success'); renderRiskAlerts(); }
  };

  window._refreshAlerts = function () {
    toast('正在重新计算风险提醒...', 'info');
    AI.generateAlerts(state.contracts).then(a => { state.alerts = a; toast('风险提醒已刷新', 'success'); renderRiskAlerts(); });
  };

  window._markAllResolved = function () {
    state.alerts.forEach(a => a.resolved = true);
    toast('所有风险提醒已标记为处理', 'success');
    renderRiskAlerts();
  };

  // AI 提取
  window._runAIExtract = async function (contractId) {
    const c = state.contracts.find(x => x.id === contractId);
    if (!c) return;
    $('aiExtractResult').innerHTML = '<div style="text-align:center;padding:30px"><span style="font-size:24px">⏳</span><br><span class="text-muted">正在进行 AI 智能提取...</span></div>';
    await new Promise(r => setTimeout(r, 1500));
    const fields = [
      { field: '合同编号', value: c.code, confidence: 0.95 },
      { field: '甲方名称', value: c.partyA, confidence: 0.90 },
      { field: '乙方名称', value: c.partyB, confidence: 0.97 },
      { field: '合同总金额', value: fmtMoney(c.amount), confidence: 0.93 },
      { field: '签订日期', value: fmt(c.signDate), confidence: 0.91 },
      { field: '付款条件', value: c.paymentTerms, confidence: 0.85 },
      { field: '服务期限', value: c.servicePeriod, confidence: 0.78 },
      { field: '交付物', value: c.deliverables, confidence: 0.82 },
    ];
    $('aiExtractResult').innerHTML = `
      <div class="card" style="background:#f6ffed;border:1px solid #b7eb8f">
        <div class="text-bold text-green mb-12">✅ 智能提取完成（模拟）· 已提取 ${fields.length} 个字段</div>
        <div class="alert alert-info mb-12">💡 AI 提取数据与人工填写数据<strong>分开存储，不合并</strong>。对比差异后可人工修正。</div>
        <table style="width:100%">
          <thead><tr><th>字段</th><th>合同已有值</th><th>AI 提取值</th><th>置信度</th><th>差异</th></tr></thead>
          <tbody>
            ${fields.map(f => {
              const existing = c[f.field] || c[f.field === '合同总金额' ? 'amount' : f.field === '签订日期' ? 'signDate' : f.field === '甲方名称' ? 'partyA' : f.field === '乙方名称' ? 'partyB' : f.field === '付款条件' ? 'paymentTerms' : f.field === '服务期限' ? 'servicePeriod' : f.field === '交付物' ? 'deliverables' : ''];
              const existingStr = existing ? (f.field === '合同总金额' ? fmtMoney(existing) : String(existing)) : '—';
              const diff = existingStr !== '—' && existingStr !== f.value ? '⚠️ 有差异' : '✅ 一致';
              return `<tr>
                <td class="text-bold">${esc(f.field)}</td>
                <td>${esc(existingStr)}</td>
                <td class="text-primary">${esc(f.value)}</td>
                <td><div class="progress-bar" style="width:60px;display:inline-block"><div class="progress-fill" style="width:${Math.round(f.confidence * 100)}%"></div></div> ${Math.round(f.confidence * 100)}%</td>
                <td><span class="tag ${diff.includes('有差异') ? 'tag-orange' : 'tag-green'}">${diff}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  };

  // OCR 流程
  window._startOCR = async function () {
    const fileInput = $('fileInput');
    const fileName = fileInput.files[0]?.name || 'contract_scan.jpg';
    if (!fileInput.files.length) { toast('请先选择文件', 'warning'); return; }
    const btn = $('startOCRBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 识别中，请稍候...';
    const result = await AI.simulateOCR(fileName);
    window._ocrResult = result;
    $('step0').className = 'step done';
    $('step0').querySelector('.step-dot').textContent = '✓';
    $('uploadStep').classList.add('hidden');
    $('extractStep').classList.remove('hidden');
    $('step1').className = 'step active';
    $('ocrRawText').textContent = result.rawText;
    $('fieldsTable').innerHTML = '<table style="width:100%"><thead><tr><th>字段</th><th>AI 提取值</th><th>人工修正值 <span style="font-size:11px;color:var(--muted)">（请填写）</span></th><th>置信度</th></tr></thead><tbody>' +
      result.fields.map((f, i) => `<tr>
        <td class="text-bold">${esc(f.field)}</td>
        <td class="text-muted">${esc(f.value) || '—'}</td>
        <td><input class="form-input" data-field="${esc(f.field)}" value="${esc(f.value)}" placeholder="修正后填入"></td>
        <td>${f.confidence > 0 ? '<div class="progress-bar" style="width:60px;display:inline-block"><div class="progress-fill" style="width:' + Math.round(f.confidence * 100) + '%"></div></div> ' + Math.round(f.confidence * 100) + '%' : '—'}</td>
      </tr>`).join('') + '</tbody></table>';
    btn.disabled = false;
    btn.textContent = '📄 开始 OCR 识别与信息提取';
  };

  // AI 评审
  window._startReview = async function () {
    const inputs = $('fieldsTable').querySelectorAll('input[data-field]');
    window._editedFields = {};
    inputs.forEach(inp => { window._editedFields[inp.dataset.field] = inp.value; });

    $('extractStep').classList.add('hidden');
    $('reviewStep').classList.remove('hidden');
    $('step2').className = 'step active';
    $('reviewResults').innerHTML = '<div style="text-align:center;padding:40px"><span style="font-size:32px">⏳</span><p class="text-muted">正在执行 AI 评审...</p><p class="text-muted" style="font-size:12px">法务预审 → 合规性检查 → 历史对比</p></div>';

    const contract = { partyA: window._editedFields['甲方名称'] || '示例', amount: parseFloat((window._editedFields['合同总金额'] || '0').replace(/[¥,]/g, '').replace(/[^\d.]/g, '')) || 0, paymentTerms: window._editedFields['付款条件'] || '', subject: window._editedFields['合同标的物'] || '' };
    const [sensitive, regulations, comparison] = await Promise.all([
      AI.checkSensitive(JSON.stringify(window._editedFields)),
      AI.checkRegulations(contract),
      AI.compareHistory(contract),
    ]);

    $('reviewResults').innerHTML = `
      <div class="card mb-12" style="border:1px solid ${sensitive.length ? 'var(--red)' : 'var(--green)'};background:${sensitive.length ? '#fff1f0' : '#f6ffed'}">
        <div class="card-title mb-8">🔍 法务预审：敏感词检测</div>
        ${sensitive.length === 0 ? '<span class="tag tag-green">✅ 未发现敏感词，法务预审通过</span>' : '<div style="display:grid;gap:8px">' + sensitive.map(s => '<div class="alert alert-danger"><strong>' + esc(s.word) + '</strong> — 发现敏感词，建议使用更标准表述。参考：用"优先合作权"替代"独家经营"。</div>').join('') + '</div>'}
      </div>

      <div class="card mb-12">
        <div class="card-title mb-8">⚖️ 合规性检查：法规比对</div>
        <div class="table-wrap"><table>
          <thead><tr><th>法规编号与名称</th><th>合规状态</th><th>备注</th></tr></thead>
          <tbody>${regulations.map(r => `<tr>
            <td>${esc(r.regulation)}</td>
            <td><span class="tag ${r.compliant ? 'tag-green' : 'tag-red'}">${r.compliant ? '✅ 合规' : '⚠️ 需复核'}</span></td>
            <td class="text-muted" style="font-size:12px">${esc(r.note)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>

      <div class="card mb-12">
        <div class="card-title mb-8">📊 历史对比：价格/条款差异提醒</div>
        <div style="display:grid;gap:10px">
          ${comparison.map(c => `<div class="alert alert-warning">
            <strong>${esc(c.field)}</strong><br>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:8px;font-size:13px">
              <div>当前值：<span class="text-bold">${esc(c.current)}</span></div>
              <div>历史均值：<span>${esc(c.avgHistory)}</span></div>
              <div>偏差：<span class="text-orange">${esc(c.deviation)}</span></div>
            </div>
            <div style="font-size:12px;color:var(--muted);margin-top:4px">建议：${esc(c.advice)}</div>
          </div>`).join('')}
        </div>
      </div>

      <div class="alert alert-info">📌 评审结论：以上为 AI 预审结果，建议结合人工审核最终确定。评审内容覆盖：单价、技术参数、周期、客户名称，并与历史订单进行对比分析。</div>
    `;
  };

  // 保存到台账
  window._saveToLedger = function () {
    const fields = window._editedFields || {};
    const c = {
      id: 'c-' + Date.now(),
      code: fields['合同编号'] || 'HT-2024-' + Date.now().toString().slice(-4),
      partyA: fields['甲方名称'] || '示例甲方',
      partyB: fields['乙方名称'] || '上海月明信息系统有限公司',
      signDate: fields['签订日期'] || fmt(new Date()),
      effectiveDate: fmt(dLater(7)), expireDate: fmt(dLater(365)),
      dept: '销售部', handler: state.user.name,
      amount: parseFloat((fields['合同总金额'] || '0').replace(/[¥,]/g, '').replace(/[^\d.]/g, '')) || 0,
      subject: fields['合同标的物'] || '', unitPrice: 0, taxRate: 13,
      paymentTerms: fields['付款条件'] || '', deposit: 0,
      deliverables: fields['交付物'] || '', acceptanceStandard: fields['验收标准'] || '',
      servicePeriod: fields['服务期限'] || '', renewalConditions: fields['续约条件'] || '',
      stage: 'S4_确认', status: 'pending',
      createdAt: fmt(new Date()), updatedAt: fmt(new Date()),
    };
    state.contracts.unshift(c);
    $('reviewStep').classList.add('hidden');
    $('doneStep').classList.remove('hidden');
    $('step3').className = 'step done';
    $('step3').querySelector('.step-dot').textContent = '✓';
    $('savedCode').textContent = c.code;
    toast('合同 ' + c.code + ' 已录入台账，等待审核', 'success');
    AI.generateAlerts(state.contracts).then(a => state.alerts = a);
  };

  window._uploadStep = function (step) {
    $('step0').className = 'step ' + (step > 0 ? 'done' : 'active');
    $('step1').className = 'step ' + (step > 1 ? 'done' : step === 1 ? 'active' : '');
    $('step2').className = 'step ' + (step > 2 ? 'done' : step === 2 ? 'active' : '');
    $('step3').className = 'step ' + (step === 3 ? 'active' : '');
    $('uploadStep').classList.toggle('hidden', step !== 0);
    $('extractStep').classList.toggle('hidden', step !== 1);
    $('reviewStep').classList.toggle('hidden', step !== 2);
    $('doneStep').classList.toggle('hidden', step !== 3);
  };

  window._resetUpload = function () {
    window._ocrResult = null;
    window._editedFields = {};
    $('fileInput').value = '';
    $('uploadFileInfo').classList.add('hidden');
  };

  // 合同评审
  window._runReview = function (id) {
    const record = { id, code: 'HT-2024-00' + id.slice(-1), partyA: '示例甲方', amount: 1560000, subject: 'ERP系统迁移' };
    showModal('AI 合同评审 · ' + record.code, `
      <div id="reviewLoading" style="text-align:center;padding:40px">
        <div style="font-size:32px">⏳</div>
        <p class="text-muted">正在执行 AI 评审...</p>
        <p class="text-muted" style="font-size:12px">法务预审 → 合规性检查 → 历史对比</p>
      </div>
      <div id="reviewOutput"></div>
    `);
    setTimeout(async () => {
      const sensitive = await AI.checkSensitive(record.partyA + ' ' + record.subject);
      const regulations = await AI.checkRegulations(record);
      const comparison = await AI.compareHistory(record);
      $('reviewLoading').style.display = 'none';
      $('reviewOutput').innerHTML = `
        <div class="card mb-12" style="border:1px solid ${sensitive.length ? 'var(--red)' : 'var(--green)'};background:${sensitive.length ? '#fff1f0' : '#f6ffed'}">
          <div class="card-title mb-8">🔍 法务预审：敏感词检测</div>
          ${sensitive.length === 0 ? '<span class="tag tag-green">✅ 未发现敏感词</span>' : sensitive.map(s => '<div class="alert alert-danger mt-8"><strong>' + esc(s.word) + '</strong></div>').join('')}
          <div style="font-size:12px;color:var(--muted);margin-top:8px">检查范围：合同全文、附件、补充条款</div>
        </div>

        <div class="card mb-12">
          <div class="card-title mb-8">⚖️ 合规性检查：法规比对</div>
          <div class="table-wrap"><table>
            <thead><tr><th>法规</th><th>状态</th><th>备注</th></tr></thead>
            <tbody>${regulations.map(r => `<tr><td>${esc(r.regulation)}</td><td><span class="tag ${r.compliant ? 'tag-green' : 'tag-red'}">${r.compliant ? '合规' : '需复核'}</span></td><td class="text-muted" style="font-size:12px">${esc(r.note)}</td></tr>`).join('')}</tbody>
          </table></div>
        </div>

        <div class="card">
          <div class="card-title mb-8">📊 历史对比</div>
          ${comparison.map(c => `<div class="alert alert-warning"><strong>${esc(c.field)}</strong> · 偏差：${esc(c.deviation)}<br><span style="font-size:12px">${esc(c.advice)}</span></div>`).join('')}
        </div>

        <div style="text-align:center;margin-top:20px">
          <button class="btn btn-success" onclick="hideModal();toast('合同已通过评审')">✓ 通过</button>
          <button class="btn btn-danger" onclick="hideModal();toast('合同已退回修改')">✕ 驳回</button>
        </div>
      `;
    }, 2000);
  };

  // 知识库
  window._uploadDoc = function (input) {
    const file = input.files[0];
    if (!file) return;
    const doc = {
      id: 'd-' + Date.now(),
      title: file.name.replace(/\.[^.]+$/, ''),
      description: '用户上传文档',
      filename: file.name, fileType: file.name.split('.').pop(),
      size: file.size, folder: '未分类',
      versions: [{ version: '1.0', filename: file.name, size: file.size, updatedAt: fmt(new Date()), author: state.user.name, changelog: '初始上传' }],
      tags: ['文档'],
      permissions: { roles: ['admin', 'manager', 'user'], public: true },
      createdAt: fmt(new Date()), updatedAt: fmt(new Date()),
    };
    state.knowledgeDocs.unshift(doc);
    toast('文档上传成功：' + doc.title, 'success');
    renderKnowledge();
  };

  window._viewDoc = function (id) { renderDocDetail(id); };

  window._filterDocs = function () {
    const kw = ($('kbSearch')?.value || '').toLowerCase();
    const type = $('kbTypeFilter')?.value;
    document.querySelectorAll('.doc-card').forEach(card => {
      const title = card.dataset.title || '';
      const tags = (card.dataset.tags || '').toLowerCase();
      const cardType = card.dataset.type || '';
      const show = (!kw || title.includes(kw) || tags.includes(kw)) && (!type || cardType === type);
      card.style.display = show ? '' : 'none';
    });
  };

  window._batchAction = function (type) {
    toast(type === 'reindex' ? '批量重新索引任务已提交' : '批量同步至 Dify 任务已提交', 'success');
  };

  // OA 同步
  window._triggerSync = function (id) {
    const c = state.oaConfigs.find(x => x.id === id);
    if (!c) return;
    toast('正在同步 ' + ({ yonyou: '用友', jd: '金蝶', custom: '自定义' }[c.platform]) + ' 数据...', 'info');
    setTimeout(() => {
      c.lastSyncAt = new Date().toISOString();
      c.lastSyncStatus = 'success';
      toast('同步完成：' + c.fieldMappings.length + ' 条字段映射成功', 'success');
      renderOASync();
    }, 2000);
  };

  window._deleteOaConfig = function (id) {
    state.oaConfigs = state.oaConfigs.filter(c => c.id !== id);
    toast('同步配置已删除', 'warning');
    renderOASync();
  };

  // 角色切换
  window._switchRole = function (role) {
    state.user.role = role;
    state.user.name = role === 'admin' ? '管理员' : role === 'manager' ? '项目经理' : '普通用户';
    $('userBadge').textContent = state.user.name + ' · ' + role;
    toast('已切换为：' + state.user.name, 'success');
  };

  // 批量导出
  window._batchExport = function () {
    toast('台账导出功能（演示）：将导出当前数据为 CSV/Excel 格式', 'info');
  };

  // ==================== 导航系统 ====================
  function navigate(page) {
    state.currentPage = page;

    const renderers = {
      'dashboard': renderDashboard,
      'contract': renderContractList,
      'contract-upload': renderContractUpload,
      'contract-review': renderContractReview,
      'contract-risk': renderRiskAlerts,
      'contract-ledger': renderLedger,
      'knowledge': renderKnowledge,
      'oa-sync': renderOASync,
      'settings': renderSettings,
    };

    let renderer = renderers[page];
    if (!renderer) {
      const detailMatch = page.match(/^contract-([a-zA-Z0-9]+)$/);
      if (detailMatch) { renderContractDetail(detailMatch[1]); return; }
      renderer = renderDashboard;
    }

    $('content').innerHTML = '<div style="text-align:center;padding:60px;color:var(--muted)">⏳ 加载中...</div>';
    setTimeout(() => renderer(), 60);

    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });
  }

  // ==================== Tabs ====================
  function initTabs() {
    document.querySelectorAll('.tabs').forEach(tabGroup => {
      const groupName = tabGroup.dataset.tabGroup;
      tabGroup.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
          tabGroup.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const parent = tabGroup.parentElement;
          parent.querySelectorAll('.tab-content').forEach(tc => tc.classList.add('hidden'));
          const target = parent.querySelector('#tab-' + btn.dataset.tab);
          if (target) target.classList.remove('hidden');
        };
      });
    });
  }

  // ==================== 初始化 ====================
  function init() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.onclick = (e) => { e.preventDefault(); navigate(item.dataset.page); };
    });

    $('collapseBtn').onclick = () => {
      state.collapsed = !state.collapsed;
      $('sidebar').classList.toggle('collapsed', state.collapsed);
      $('collapseBtn').textContent = state.collapsed ? '▶' : '◀';
    };

    $('modalOverlay').onclick = (e) => { if (e.target === $('modalOverlay')) hideModal(); };

    document.addEventListener('click', (e) => {
      const navEl = e.target.closest('[data-nav]');
      if (navEl) { e.preventDefault(); navigate(navEl.dataset.nav); }
    });

    initMockData();
    navigate('dashboard');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
