import { useEffect, useMemo, useState } from 'react';
import { Card, Table, Button, Tag, Space, Typography, Input, Row, Col, Statistic, DatePicker, Select, message, Tabs } from 'antd';
import { ExportOutlined, FilterOutlined, FileTextOutlined, EyeOutlined, EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/app-store';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

export default function Ledger() {
  const navigate = useNavigate();
  const contracts = useAppStore((state) => state.contracts);
  const [filtered, setFiltered] = useState(contracts);
  const [searchText, setSearchText] = useState('');
  const [dateRange, setDateRange] = useState<any>(null);
  const [stageFilter, setStageFilter] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    setFiltered(contracts);
  }, [contracts]);

  const doFilter = () => {
    let data = [...contracts];
    if (searchText) {
      const kw = searchText.toLowerCase();
      data = data.filter((contract) => contract.code.toLowerCase().includes(kw) || contract.partyA.toLowerCase().includes(kw) || contract.subject.toLowerCase().includes(kw));
    }
    if (dateRange && dateRange.length === 2) {
      const [start, end] = dateRange;
      data = data.filter((contract) => dayjs(contract.signDate).isAfter(start.subtract(1, 'day')) && dayjs(contract.signDate).isBefore(end.add(1, 'day')));
    }
    if (stageFilter) data = data.filter((contract) => contract.stage === stageFilter);
    setFiltered(data);
  };

  const handleExport = () => {
    message.info('台账导出功能待接入 CSV/Excel');
  };

  const columns = [
    { title: '合同编号', dataIndex: 'code', key: 'code', render: (value: string, record: any) => <a style={{ color: '#1a73e8' }} onClick={() => navigate(`/contract/${record.id}`)}>{value}</a> },
    { title: '甲方名称', dataIndex: 'partyA', key: 'partyA' },
    { title: '合同标的物', dataIndex: 'subject', key: 'subject' },
    { title: '合同金额', dataIndex: 'amount', key: 'amount', render: (value: number) => <Text strong style={{ color: '#1a73e8' }}>¥{value.toLocaleString()}</Text> },
    { title: '签订日期', dataIndex: 'signDate', key: 'signDate', render: (value: string) => dayjs(value).format('YYYY-MM-DD') },
    { title: '生效日期', dataIndex: 'effectiveDate', key: 'effectiveDate', render: (value: string) => dayjs(value).format('YYYY-MM-DD') },
    { title: '到期日期', dataIndex: 'expireDate', key: 'expireDate', render: (value: string) => dayjs(value).format('YYYY-MM-DD') },
    { title: '阶段', dataIndex: 'stage', key: 'stage', render: (value: string) => <Tag color={value === 'completed' ? 'default' : 'blue'}>{value}</Tag> },
    { title: '经办部门', dataIndex: 'dept', key: 'dept' },
    { title: '经办人', dataIndex: 'handler', key: 'handler' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (value: string) => <Tag color={value === 'risk' ? 'red' : value === 'active' ? 'green' : value === 'completed' ? 'default' : 'blue'}>{value}</Tag> },
    {
      title: '操作', key: 'action',
      render: (_: any, record: any) => (
        <Space>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/contract/${record.id}`)}>详情</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => navigate(`/contract/${record.id}`)}>编辑</Button>
        </Space>
      ),
    },
  ];

  const totalAmount = useMemo(() => contracts.reduce((sum, contract) => sum + contract.amount, 0), [contracts]);
  const avgAmount = contracts.length ? totalAmount / contracts.length : 0;

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>合同台账</Title>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'overview',
            label: '台账总览',
            children: (
              <>
                <Row gutter={16} style={{ marginBottom: 16 }}>
                  <Col span={6}><Card size="small"><Statistic title="合同总数" value={contracts.length} prefix={<FileTextOutlined />} /></Card></Col>
                  <Col span={6}><Card size="small"><Statistic title="签约总额" value={Math.round(totalAmount / 10000)} prefix={<span style={{ color: '#1a73e8' }}>¥</span>} suffix="万元" /></Card></Col>
                  <Col span={6}><Card size="small"><Statistic title="平均金额" value={Math.round(avgAmount)} prefix={<span>¥</span>} /></Card></Col>
                  <Col span={6}><Card size="small"><Statistic title="履约中" value={contracts.filter((contract) => contract.status === 'active').length} /></Card></Col>
                </Row>

                <Card>
                  <Space style={{ marginBottom: 16 }} wrap>
                    <Input.Search placeholder="搜索合同编号/甲方" style={{ width: 240 }} value={searchText} onChange={(event) => setSearchText(event.target.value)} onSearch={doFilter} />
                    <RangePicker onChange={(value) => { setDateRange(value); setTimeout(doFilter, 100); }} />
                    <Select style={{ width: 140 }} placeholder="合同阶段" allowClear onChange={(value) => { setStageFilter(value); setTimeout(doFilter, 100); }}>
                      <Select.Option value="S4_确认">S4 确认</Select.Option>
                      <Select.Option value="S5_签订">S5 签订</Select.Option>
                      <Select.Option value="S6_履约">S6 履约</Select.Option>
                      <Select.Option value="completed">已完成</Select.Option>
                    </Select>
                    <Button type="primary" icon={<FilterOutlined />} onClick={doFilter}>筛选</Button>
                    <Button icon={<ExportOutlined />} onClick={handleExport}>导出台账</Button>
                  </Space>
                  <Table
                    dataSource={filtered}
                    columns={columns}
                    rowKey="id"
                    pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }}
                    scroll={{ x: 1400 }}
                  />
                </Card>
              </>
            ),
          },
          {
            key: 'finance',
            label: '财务台账',
            children: (
              <Card>
                <Row gutter={16} style={{ marginBottom: 16 }}>
                  <Col span={8}><Card size="small"><Statistic title="应付总额" value={Math.round(totalAmount * 0.65 / 10000)} prefix="¥" suffix="万元" /></Card></Col>
                  <Col span={8}><Card size="small"><Statistic title="已回款" value={Math.round(totalAmount * 0.45 / 10000)} prefix="¥" suffix="万元" /></Card></Col>
                  <Col span={8}><Card size="small"><Statistic title="质保金" value={Math.round(totalAmount * 0.05 / 10000)} prefix="¥" suffix="万元" /></Card></Col>
                </Row>
                <Table
                  dataSource={contracts}
                  columns={[
                    { title: '合同编号', dataIndex: 'code', key: 'code' },
                    { title: '甲方', dataIndex: 'partyA', key: 'partyA' },
                    { title: '总金额', dataIndex: 'amount', key: 'amount', render: (value: number) => `¥${value.toLocaleString()}` },
                    { title: '税率', dataIndex: 'taxRate', key: 'taxRate', render: (value: number) => `${value}%` },
                    { title: '付款条件', dataIndex: 'paymentTerms', key: 'paymentTerms', ellipsis: true },
                    { title: '保证金', dataIndex: 'deposit', key: 'deposit', render: (value: number) => value ? `¥${value.toLocaleString()}` : '无' },
                  ]}
                  rowKey="id"
                  pagination={{ pageSize: 10 }}
                />
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
}
