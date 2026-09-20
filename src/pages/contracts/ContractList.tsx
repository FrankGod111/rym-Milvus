import { useEffect, useMemo, useState } from 'react';
import { Table, Button, Space, Tag, Modal, Form, Input, InputNumber, DatePicker, Select, message, Popconfirm, Row, Col, Card, Statistic, Typography } from 'antd';
import { PlusOutlined, EyeOutlined, EditOutlined, DeleteOutlined, FileTextOutlined, ExportOutlined, ExclamationCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/app-store';
import type { Contract, ContractStage, ContractStatus } from '@/types';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const stageColorMap: Record<string, string> = {
  'S4_确认': 'blue',
  'S5_签订': 'orange',
  'S6_履约': 'green',
  completed: 'default',
};

const statusColorMap: Record<string, string> = {
  active: 'green',
  pending: 'blue',
  completed: 'default',
  risk: 'red',
};

const stageOptions: ContractStage[] = ['S4_确认', 'S5_签订', 'S6_履约', 'completed'];

export default function ContractList() {
  const navigate = useNavigate();
  const contracts = useAppStore((state) => state.contracts);
  const loadContracts = useAppStore((state) => state.loadContracts);
  const saveContract = useAppStore((state) => state.saveContract);
  const updateContractStage = useAppStore((state) => state.updateContractStage);
  const removeContract = useAppStore((state) => state.removeContract);
  const addNotification = useAppStore((state) => state.addNotification);

  const [filteredData, setFilteredData] = useState<Contract[]>(contracts);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    loadContracts().catch(() => {
      message.error('加载合同列表失败');
    });
  }, [loadContracts]);

  useEffect(() => {
    setFilteredData(contracts);
  }, [contracts]);

  const handleSearch = (values: any) => {
    let data = [...contracts];
    if (values.keyword) {
      const kw = values.keyword.toLowerCase();
      data = data.filter((contract) => contract.code.toLowerCase().includes(kw) || contract.partyA.toLowerCase().includes(kw) || contract.subject.toLowerCase().includes(kw));
    }
    if (values.status) data = data.filter((contract) => contract.status === values.status);
    if (values.stage) data = data.filter((contract) => contract.stage === values.stage);
    if (values.dateRange && values.dateRange.length === 2) {
      const [start, end] = values.dateRange;
      data = data.filter((contract) => dayjs(contract.signDate).isAfter(start.subtract(1, 'day')) && dayjs(contract.signDate).isBefore(end.add(1, 'day')));
    }
    setFilteredData(data);
  };

  const handleAdd = () => {
    setEditingId(null);
    form.resetFields();
    setIsModalOpen(true);
  };

  const columns: ColumnsType<Contract> = useMemo(() => [
    { title: '合同编号', dataIndex: 'code', key: 'code', render: (value, record) => <a onClick={() => navigate(`/contract/${record.id}`)} style={{ color: '#1a73e8' }}>{value}</a> },
    { title: '甲方名称', dataIndex: 'partyA', key: 'partyA', ellipsis: true },
    { title: '合同标的物', dataIndex: 'subject', key: 'subject', ellipsis: true },
    {
      title: '合同金额', dataIndex: 'amount', key: 'amount', sorter: (a, b) => a.amount - b.amount,
      render: (value) => <span style={{ fontWeight: 600 }}>¥{value.toLocaleString()}</span>,
    },
    { title: '签订日期', dataIndex: 'signDate', key: 'signDate', sorter: (a, b) => a.signDate.localeCompare(b.signDate), render: (value) => dayjs(value).format('YYYY-MM-DD') },
    {
      title: '阶段', dataIndex: 'stage', key: 'stage',
      render: (value: ContractStage) => <Tag color={stageColorMap[value]}>{value}</Tag>,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (value: ContractStatus) => <Tag color={statusColorMap[value]}>{value === 'active' ? '履约中' : value === 'pending' ? '待处理' : value === 'completed' ? '已完成' : '风险'}</Tag>,
    },
    {
      title: '操作', key: 'action', fixed: 'right', width: 220,
      render: (_, record) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/contract/${record.id}`)}>详情</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => {
            setEditingId(record.id);
            form.setFieldsValue({
              ...record,
              signDate: record.signDate ? dayjs(record.signDate) : undefined,
              effectiveDate: record.effectiveDate ? dayjs(record.effectiveDate) : undefined,
              expireDate: record.expireDate ? dayjs(record.expireDate) : undefined,
            });
            setIsModalOpen(true);
          }}>编辑</Button>
          <Select
            size="small"
            style={{ width: 100 }}
            value={record.stage}
            onChange={async (value) => {
              try {
                await updateContractStage(record.id, value);
                addNotification(`合同 ${record.code} 已更新阶段`, 'success');
              } catch (error) {
                message.error('更新阶段失败');
              }
            }}
            options={stageOptions.map((stage) => ({ value: stage, label: stage }))}
          />
          <Popconfirm title="确认删除？" onConfirm={async () => {
            try {
              await removeContract(record.id);
              addNotification('合同已删除', 'warning');
            } catch (error) {
              message.error('删除失败');
            }
          }}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}></Button>
          </Popconfirm>
        </Space>
      ),
    },
  ], [addNotification, form, navigate, removeContract, updateContractStage]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload: Partial<Contract> = {
        id: editingId || undefined,
        code: values.code,
        partyA: values.partyA,
        partyB: values.partyB,
        signDate: values.signDate ? dayjs(values.signDate).format('YYYY-MM-DD') : '',
        effectiveDate: values.effectiveDate ? dayjs(values.effectiveDate).format('YYYY-MM-DD') : '',
        expireDate: values.expireDate ? dayjs(values.expireDate).format('YYYY-MM-DD') : '',
        dept: values.dept || '',
        handler: values.handler || '',
        amount: values.amount || 0,
        subject: values.subject || '',
        paymentTerms: values.paymentTerms || '',
        deposit: values.deposit || 0,
        taxRate: values.taxRate ?? 13,
        unitPrice: values.unitPrice || 0,
        servicePeriod: values.servicePeriod || '',
        deliverables: values.deliverables || '',
        acceptanceStandard: values.acceptanceStandard || '',
        renewalConditions: values.renewalConditions || '',
        stage: values.stage || 'S4_确认',
        status: values.status || 'pending',
      };
      await saveContract(payload);
      addNotification(editingId ? '合同信息已更新' : '新合同已创建', 'success');
      setIsModalOpen(false);
      form.resetFields();
      setEditingId(null);
    } catch (error) {
      if (error instanceof Error && !('errorFields' in (error as any))) {
        message.error(editingId ? '更新合同失败' : '创建合同失败');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Title level={3} style={{ marginBottom: 16 }}>合同列表</Title>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Statistic title="合同总数" value={contracts.length} prefix={<FileTextOutlined style={{ color: '#1a73e8' }} />} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="总额（万元）" value={(contracts.reduce((sum, contract) => sum + contract.amount, 0) / 10000).toFixed(1)} prefix={<span style={{ color: '#1a73e8' }}>¥</span>} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="风险合同" value={contracts.filter((contract) => contract.status === 'risk').length} prefix={<ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="即将到期（60天）" value={contracts.filter((contract) => { const diff = new Date(contract.expireDate).getTime() - Date.now(); return diff > 0 && diff < 60 * 86400000 && contract.status !== 'completed'; }).length} prefix={<ClockCircleOutlined style={{ color: '#faad14' }} />} /></Card></Col>
      </Row>

      <Card>
        <Form layout="inline" onFinish={handleSearch} style={{ marginBottom: 16 }}>
          <Form.Item name="keyword" label="搜索">
            <Input placeholder="编号/甲方/标的物" style={{ width: 220 }} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select style={{ width: 120 }} placeholder="全部" allowClear>
              <Select.Option value="active">履约中</Select.Option>
              <Select.Option value="pending">待处理</Select.Option>
              <Select.Option value="completed">已完成</Select.Option>
              <Select.Option value="risk">风险</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="stage" label="阶段">
            <Select style={{ width: 120 }} placeholder="全部" allowClear>
              {stageOptions.map((stage) => <Select.Option key={stage} value={stage}>{stage}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="dateRange" label="签订日期">
            <RangePicker />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">查询</Button>
              <Button onClick={() => { setFilteredData(contracts); form.resetFields(); }}>重置</Button>
            </Space>
          </Form.Item>
        </Form>
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>新建合同</Button>
            <Button icon={<ExportOutlined />} onClick={() => message.info('台账导出功能待接入')}>导出台账</Button>
          </Space>
          <Text type="secondary">共 {filteredData.length} 条记录</Text>
        </div>
        <Table
          dataSource={filteredData}
          columns={columns}
          rowKey="id"
          scroll={{ x: 1200 }}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
        />
      </Card>

      <Modal
        title={editingId ? '编辑合同' : '新建合同'}
        open={isModalOpen}
        onOk={handleOk}
        okButtonProps={{ loading: saving }}
        onCancel={() => { setIsModalOpen(false); form.resetFields(); setEditingId(null); }}
        width={800}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ taxRate: 13, stage: 'S4_确认', status: 'pending' }}>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="code" label="合同编号" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="partyA" label="甲方名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="partyB" label="乙方名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="dept" label="经办部门"><Input /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="handler" label="经办人"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="amount" label="合同总金额" rules={[{ required: true }]}><InputNumber prefix="¥" style={{ width: '100%' }} min={0} /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="subject" label="合同标的物"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="paymentTerms" label="付款条件"><Input /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="signDate" label="签订日期"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="effectiveDate" label="生效日期"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="expireDate" label="到期日期"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="taxRate" label="税率(%)"><InputNumber style={{ width: '100%' }} min={0} max={100} /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="deposit" label="保证金"><InputNumber prefix="¥" style={{ width: '100%' }} min={0} /></Form.Item></Col>
            <Col span={12}><Form.Item name="unitPrice" label="单价"><InputNumber prefix="¥" style={{ width: '100%' }} min={0} /></Form.Item></Col>
          </Row>
          <Form.Item name="servicePeriod" label="服务期限"><Input /></Form.Item>
          <Form.Item name="deliverables" label="交付物"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="acceptanceStandard" label="验收标准"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="renewalConditions" label="续约条件"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
