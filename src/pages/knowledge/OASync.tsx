import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Modal,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  ReloadOutlined,
  RollbackOutlined,
  SwapRightOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { erpApi, type ApprovalRecord } from '@/api/erp';
import BackendLoginModal from '@/components/BackendLoginModal';

const { Title, Text, Paragraph } = Typography;
type ViewFilter = 'pending' | 'processed' | 'all';

const sceneLabels: Record<string, string> = {
  'contract-review': '合同评审',
  'meeting-summary': '会议纪要',
  'test-report': '测试报告',
  'employee-qa': '知识问答',
};

function approvalStatus(value: ApprovalRecord['status']) {
  if (value === 'approved') return <Tag color="green">已通过</Tag>;
  if (value === 'rejected') return <Tag color="red">已退回</Tag>;
  return <Tag color="gold">待审批</Tag>;
}

function targetRoute(record: ApprovalRecord) {
  const output = record.output || {};
  const explicit = typeof output.redirect_to === 'string' ? output.redirect_to : '';
  if (explicit.startsWith('/')) return explicit;
  if (typeof output.contract_id === 'string' && output.contract_id) return `/contract/${output.contract_id}`;
  if (typeof output.document_id === 'string' && output.document_id) return `/knowledge/docs?document=${output.document_id}`;
  if (record.sceneType === 'contract-review') return '/contract/review';
  return '/knowledge/docs';
}

export default function OASync() {
  const navigate = useNavigate();
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [filter, setFilter] = useState<ViewFilter>('pending');
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [authOpen, setAuthOpen] = useState(!erpApi.hasSession());
  const [selected, setSelected] = useState<ApprovalRecord | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<ApprovalRecord | null>(null);

  async function load() {
    setLoading(true);
    try {
      setApprovals(await erpApi.listApprovals());
    } catch (error) {
      handleError(error, '审批任务加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function handleError(error: unknown, fallback: string) {
    const detail = error instanceof Error ? error.message : fallback;
    if (detail === 'ERP_AUTH_REQUIRED') setAuthOpen(true);
    else message.error(detail);
  }

  const rows = useMemo(() => approvals.filter((item) => {
    if (filter === 'pending') return item.status === 'pending';
    if (filter === 'processed') return item.status !== 'pending';
    return true;
  }), [approvals, filter]);

  const counts = useMemo(() => ({
    pending: approvals.filter((item) => item.status === 'pending').length,
    approved: approvals.filter((item) => item.status === 'approved').length,
    rejected: approvals.filter((item) => item.status === 'rejected').length,
  }), [approvals]);

  async function inspect(record: ApprovalRecord) {
    setSelected(record);
    setDetailOpen(true);
    try {
      setSelected(await erpApi.getApproval(record.id));
    } catch {
      // Keep list payload visible when detail refresh fails.
    }
  }

  function openDecision(status: 'approved' | 'rejected') {
    setDecision(status);
    setNote('');
  }

  async function submitDecision() {
    if (!selected || !decision) return;
    if (decision === 'rejected' && !note.trim()) {
      message.warning('退回时必须填写修改意见');
      return;
    }
    setWorking(true);
    try {
      const updated = await erpApi.decideApproval(selected.id, decision, note.trim());
      setApprovals((prev) => prev.map((item) => item.id === updated.id ? updated : item));
      setSelected(updated);
      setResult(updated);
      setDecision(null);
      setDetailOpen(false);
      setFilter('processed');
      message.success(decision === 'approved' ? '审批已通过，后续流程已放行' : '申请已退回，并记录修改意见');
    } catch (error) {
      handleError(error, '审批操作失败');
    } finally {
      setWorking(false);
    }
  }

  const columns = [
    {
      title: '审批事项', key: 'title', width: 300,
      render: (_: unknown, record: ApprovalRecord) => (
        <button className="text-link approval-title" onClick={() => void inspect(record)}>
          <strong>{record.title || '未命名审批'}</strong>
          <small>{record.id}</small>
        </button>
      ),
    },
    { title: '业务类型', dataIndex: 'sceneType', key: 'sceneType', width: 130, render: (value: string) => sceneLabels[value] || value || '通用流程' },
    { title: '发起人', dataIndex: 'requesterName', key: 'requesterName', width: 110, render: (value: string) => value || '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (value: ApprovalRecord['status']) => approvalStatus(value) },
    { title: '提交时间', key: 'submittedAt', width: 160, render: (_: unknown, record: ApprovalRecord) => dayjs(record.submittedAt || record.createdAt).format('YYYY-MM-DD HH:mm') },
    {
      title: '操作', key: 'actions', width: 210, fixed: 'right' as const,
      render: (_: unknown, record: ApprovalRecord) => (
        <Space size={2}>
          <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => void inspect(record)}>详情</Button>
          {record.status === 'pending' && (
            <>
              <Button type="text" size="small" className="approve-action" icon={<CheckOutlined />} onClick={() => { setSelected(record); openDecision('approved'); }}>通过</Button>
              <Button type="text" danger size="small" icon={<RollbackOutlined />} onClick={() => { setSelected(record); openDecision('rejected'); }}>退回</Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="workspace-page">
      <div className="page-heading">
        <div>
          <Title level={3}>OA 审批中心</Title>
          <Text type="secondary">处理 Dify 工作流与业务场景产生的人工审核任务</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新待办</Button>
      </div>

      <div className="metric-strip archive-metric-strip">
        <div><span>待审批</span><strong className={counts.pending ? 'metric-warning' : ''}>{counts.pending}</strong><small>等待人工处理</small></div>
        <div><span>已通过</span><strong>{counts.approved}</strong><small>已放行流程</small></div>
        <div><span>已退回</span><strong>{counts.rejected}</strong><small>等待修改后重提</small></div>
        <div><span>处理总量</span><strong>{approvals.length}</strong><small>全部审批记录</small></div>
      </div>

      {result && (
        <Alert
          closable
          onClose={() => setResult(null)}
          type={result.status === 'approved' ? 'success' : 'warning'}
          showIcon
          message={result.status === 'approved' ? '审批完成，流程已放行' : '申请已退回修改'}
          description={<Space wrap><span>{result.title}</span><Button size="small" type="link" icon={<SwapRightOutlined />} onClick={() => navigate(targetRoute(result))}>打开关联业务</Button></Space>}
          style={{ marginBottom: 16 }}
        />
      )}

      <section className="table-workspace">
        <div className="table-toolbar">
          <Segmented<ViewFilter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'pending', label: `待办 ${counts.pending}` },
              { value: 'processed', label: '已办' },
              { value: 'all', label: '全部' },
            ]}
          />
          <Text type="secondary"><ClockCircleOutlined /> 数据以 OA 接口实时状态为准</Text>
        </div>
        <Table<ApprovalRecord>
          rowKey="id"
          dataSource={rows}
          columns={columns}
          loading={loading}
          scroll={{ x: 980 }}
          pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 项` }}
          locale={{ emptyText: <Empty description={filter === 'pending' ? '当前没有待审批任务' : '暂无审批记录'} /> }}
        />
      </section>

      <Drawer
        title="审批详情"
        width={640}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        extra={selected?.status === 'pending' && <Space><Button icon={<RollbackOutlined />} danger onClick={() => openDecision('rejected')}>退回</Button><Button type="primary" icon={<CheckOutlined />} onClick={() => openDecision('approved')}>通过</Button></Space>}
      >
        {selected && (
          <Space direction="vertical" size={20} style={{ width: '100%' }}>
            <div className="approval-header"><div><Title level={4}>{selected.title || '审批事项'}</Title><Text type="secondary">{selected.id}</Text></div>{approvalStatus(selected.status)}</div>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="业务类型">{sceneLabels[selected.sceneType || ''] || selected.sceneType || '-'}</Descriptions.Item>
              <Descriptions.Item label="发起人">{selected.requesterName || '-'}</Descriptions.Item>
              <Descriptions.Item label="当前审批人">{selected.approverName || '待分配'}</Descriptions.Item>
              <Descriptions.Item label="提交时间">{dayjs(selected.submittedAt || selected.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
              <Descriptions.Item label="流程会话" span={2}>{selected.sessionId || '-'}</Descriptions.Item>
            </Descriptions>
            <div><Text strong>审批摘要</Text><Paragraph className="content-preview">{selected.summary || '无摘要'}</Paragraph></div>
            {selected.decisionNote && <div><Text strong>审批意见</Text><Paragraph className="decision-note">{selected.decisionNote}</Paragraph></div>}
            <div>
              <Text strong>流程输出</Text>
              <pre className="json-preview">{JSON.stringify(selected.output || {}, null, 2)}</pre>
            </div>
            <Button icon={<SwapRightOutlined />} onClick={() => navigate(targetRoute(selected))}>打开关联业务页面</Button>
          </Space>
        )}
      </Drawer>

      <Modal
        title={decision === 'approved' ? '确认通过' : '退回申请'}
        open={Boolean(decision)}
        okText={decision === 'approved' ? '确认通过' : '确认退回'}
        okButtonProps={{ danger: decision === 'rejected', loading: working }}
        onOk={() => void submitDecision()}
        onCancel={() => setDecision(null)}
      >
        <Paragraph type="secondary">
          {decision === 'approved' ? '通过后将放行当前业务流程，并进入下一节点。' : '退回后申请人需要根据意见修改并重新提交。'}
        </Paragraph>
        <Input.TextArea
          rows={4}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={decision === 'approved' ? '审批意见（可选）' : '请填写退回原因和修改要求（必填）'}
          maxLength={1000}
          showCount
        />
      </Modal>
      <BackendLoginModal open={authOpen} onAuthenticated={() => { setAuthOpen(false); void load(); }} />
    </div>
  );
}
