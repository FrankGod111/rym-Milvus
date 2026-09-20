import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, Typography, message } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { erpApi } from '@/api/erp';
import { useAppStore } from '@/stores/app-store';

const { Text } = Typography;

type Props = {
  open: boolean;
  onAuthenticated: () => void;
  onCancel?: () => void;
};

export default function BackendLoginModal({ open, onAuthenticated, onCancel }: Props) {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const setErpUser = useAppStore((state) => state.setErpUser);

  async function submit() {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const result = await erpApi.login(values.username, values.password);
      if (result.user) {
        const context = await erpApi.accessContext();
        setErpUser(result.user, context.permissions, context.menu_permissions);
      }
      form.resetFields(['password']);
      message.success('业务服务身份验证成功');
      onAuthenticated();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '登录失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      title="连接业务服务"
      open={open}
      closable={Boolean(onCancel)}
      maskClosable={false}
      footer={null}
      onCancel={onCancel}
    >
      <Alert
        type="info"
        showIcon
        message="使用 ERP 账号验证"
        description="登录令牌仅保存在当前浏览器会话；Dify 密钥由后端环境变量管理。"
        style={{ marginBottom: 18 }}
      />
      <Form form={form} layout="vertical" onFinish={() => void submit()}>
        <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
          <Input prefix={<UserOutlined />} autoComplete="username" />
        </Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
          <Input.Password prefix={<LockOutlined />} autoComplete="current-password" onPressEnter={() => void submit()} />
        </Form.Item>
        <Text type="secondary">账号权限决定可查看的文档范围和可执行的业务操作。</Text>
        <Button type="primary" htmlType="submit" block loading={loading} style={{ marginTop: 16 }}>登录并连接</Button>
      </Form>
    </Modal>
  );
}
