import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography, message } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { erpApi } from '@/api/erp';
import { useAppStore } from '@/stores/app-store';

const { Title, Text } = Typography;

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const setErpUser = useAppStore((state) => state.setErpUser);
  const setAuthenticated = useAppStore((state) => state.setAuthenticated);

  async function submit(values: { username: string; password: string }) {
    setLoading(true);
    try {
      const result = await erpApi.login(values.username, values.password);
      const context = await erpApi.accessContext();
      setErpUser(context.user || result.user || { id: '', name: values.username, username: values.username }, context.permissions, context.menu_permissions);
      setAuthenticated(true);
      message.success(`登录成功，所属部门：${context.user?.department_name || '未设置部门'}`);
    } catch (error) {
      erpApi.logout();
      setAuthenticated(false);
      message.error(error instanceof Error ? error.message : '登录失败');
    } finally { setLoading(false); }
  }

  return <main className="erp-login-page">
    <section className="erp-login-panel">
      <div className="erp-login-brand"><div className="erp-login-mark">月</div><div><Text className="erp-login-kicker">ENTERPRISE INTELLIGENCE</Text><Title level={2}>月明智能管理平台</Title></div></div>
      <Text type="secondary">统一文档、档案、知识库与智能问答工作台</Text>
      <Card className="erp-login-card" bordered={false}>
        <div className="erp-login-card-heading"><div><Title level={4}>登录业务服务</Title><Text type="secondary">使用 ERP 账号进入对应权限范围</Text></div></div>
        <Alert type="info" showIcon message="登录后菜单和文档范围会自动按角色加载" style={{ marginBottom: 20 }} />
        <Form layout="vertical" onFinish={(values) => void submit(values)}>
          <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}><Input size="large" prefix={<UserOutlined />} autoComplete="username" placeholder="请输入 ERP 账号" /></Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}><Input.Password size="large" prefix={<LockOutlined />} autoComplete="current-password" placeholder="请输入密码" /></Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={loading}>登录并进入系统</Button>
        </Form>
      </Card>
    </section>
  </main>;
}
