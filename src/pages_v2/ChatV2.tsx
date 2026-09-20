import { useEffect, useRef, useState } from 'react';
import { Button, Empty, Input, List, Popconfirm, Space, Tag, Typography, message } from 'antd';
import { BookOutlined, DeleteOutlined, DownloadOutlined, HistoryOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { erpApi, type AssistantSession, type ChatSource } from '@/api/erp';
import BackendLoginModal from '@/components/BackendLoginModal';

const { Title, Text, Paragraph } = Typography;

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: string;
  sources?: ChatSource[];
  error?: boolean;
};

function id() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sessionDate(value?: string) {
  return value ? dayjs(value).format('MM-DD HH:mm') : '';
}

function sessionMessages(session: AssistantSession): ChatMessage[] {
  if (session.messages?.length) {
    return session.messages.flatMap((turn, index) => {
      const at = sessionDate(turn.createdAt || turn.created_at) || sessionDate(session.updatedAt || session.updated_at) || dayjs().format('HH:mm');
      const rows: ChatMessage[] = [];
      if (turn.question) rows.push({ id: `${turn.id || session.id}-q-${index}`, role: 'user', content: turn.question, at });
      if (turn.answer) rows.push({ id: `${turn.id || session.id}-a-${index}`, role: 'assistant', content: turn.answer, at, sources: turn.citations || [] });
      return rows;
    });
  }
  const question = String(session.input?.question || session.input?.message || '').trim();
  const answer = String(session.output?.answer || session.summary || '').trim();
  const at = sessionDate(session.updatedAt || session.updated_at) || dayjs().format('HH:mm');
  const rows: ChatMessage[] = [];
  if (question) rows.push({ id: `${session.id}-q`, role: 'user', content: question, at });
  if (answer) rows.push({ id: `${session.id}-a`, role: 'assistant', content: answer, at, sources: session.citations || [] });
  return rows;
}

export default function ChatV2() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const [sessions, setSessions] = useState<AssistantSession[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [authOpen, setAuthOpen] = useState(!erpApi.hasSession());
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  async function loadHistory() {
    if (!erpApi.hasSession()) return;
    setLoadingHistory(true);
    try {
      const sessionRows = await erpApi.assistantSessions();
      setSessions(sessionRows || []);
      if (!conversationId && sessionRows?.[0]) await openSession(sessionRows[0], false);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '历史记录加载失败';
      if (detail === 'ERP_AUTH_REQUIRED') setAuthOpen(true); else message.error(detail);
    } finally { setLoadingHistory(false); }
  }

  useEffect(() => { void loadHistory(); }, []);

  async function openSession(session: AssistantSession, fetchDetail = true) {
    try {
      const detail = fetchDetail ? await erpApi.assistantSessionDetail(session.id) : session;
      setMessages(sessionMessages(detail));
      setConversationId(String(detail.conversationId || detail.conversation_id || ''));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '会话打开失败');
    }
  }

  async function deleteSession(session: AssistantSession) {
    try {
      await erpApi.deleteAssistantSession(session.id);
      setSessions((prev) => prev.filter((item) => item.id !== session.id));
      if (conversationId === String(session.conversationId || session.conversation_id || '')) reset();
      message.success('历史会话已删除');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '历史会话删除失败');
    }
  }

  async function downloadSource(source: ChatSource) {
    if (!source.erp_document_id || !source.can_download) return;
    try {
      const blob = await erpApi.downloadDocument(source.erp_document_id);
      if (blob.size === 0) throw new Error('该文档下载内容为空，ERP 未保存可用的原始附件');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = source.download_file_name || source.document_name || source.title || '知识库文档';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '文档下载失败');
    }
  }

  function exportRetrievedContent(source: ChatSource) {
    const content = String(source.content || '').trim();
    if (!content) { message.warning('该引用没有可导出的正文内容'); return; }
    const title = source.document_name || source.title || 'Dify检索内容';
    const text = '# ' + title + '\n\n来源：Dify 知识库检索片段\n导出时间：' + dayjs().format('YYYY-MM-DD HH:mm:ss') + '\n\n' + content + '\n';
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = title.replace(/[\\/:*?"<>|]/g, '_') + '-检索内容.md'; anchor.click(); URL.revokeObjectURL(url);
  }

  async function send() {
    const question = input.trim();
    if (!question || sending) return;
    const assistantId = id();
    setMessages((prev) => [...prev, { id: id(), role: 'user', content: question, at: dayjs().format('HH:mm') }]);
    setInput('');
    setSending(true);
    try {
      const response = await erpApi.assistantTurn(question, conversationId);
      if (response.conversation_id) setConversationId(response.conversation_id);
      const session = response.session;
      if (session) {
        setSessions((prev) => [session, ...prev.filter((item) => item.id !== session.id)]);
      }
      setMessages((prev) => [...prev, {
        id: assistantId,
        role: 'assistant',
        content: response.reply || '工作流已结束，但没有返回文本。',
        at: dayjs().format('HH:mm'),
        sources: response.citations || session?.citations || [],
      }]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '智能问答服务暂时不可用';
      if (detail === 'ERP_AUTH_REQUIRED') {
        setAuthOpen(true);
      } else {
        setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: detail, at: dayjs().format('HH:mm'), error: true }]);
        message.error(detail);
      }
    } finally { setSending(false); }
  }

  function reset() {
    setConversationId('');
    setMessages([]);
  }

  return (
    <div className="chat-page-v2">
      <aside className="chat-context-panel">
        <div className="agent-symbol">问</div>
        <Title level={4}>企业知识助手</Title>
        <Paragraph type="secondary">查询企业制度、合同、档案与业务知识，回答范围遵循当前账号权限。</Paragraph>
        <div className="connection-line"><span className="status-dot" /><Text>知识服务可用</Text></div>
        <div className="connection-line"><BookOutlined /><Text>企业知识库</Text></div>
        {conversationId && <Tag color="blue">会话 {conversationId.slice(0, 8)}</Tag>}
        <Button block icon={<DeleteOutlined />} onClick={reset}>新建会话</Button>
        <div className="chat-history-heading"><Text strong><HistoryOutlined /> 历史会话</Text><Button type="text" size="small" icon={<ReloadOutlined />} loading={loadingHistory} onClick={() => void loadHistory()} /></div>
        <List
          className="chat-history-list"
          size="small"
          locale={{ emptyText: '暂无历史会话' }}
          dataSource={sessions.slice(0, 8)}
          renderItem={(session) => (
            <List.Item className="chat-history-item" onClick={() => void openSession(session)} actions={[<Popconfirm key="delete" title="删除这条历史会话？" description="删除后无法恢复。" okText="删除" cancelText="取消" onConfirm={(event) => { event?.stopPropagation(); return deleteSession(session); }} onCancel={(event) => event?.stopPropagation()}><Button type="text" danger icon={<DeleteOutlined />} aria-label="删除历史会话" onClick={(event) => event.stopPropagation()} /></Popconfirm>]}> 
              <div><Text ellipsis={{ tooltip: session.title }}>{session.title || '未命名会话'}</Text><small>{sessionDate(session.updatedAt || session.updated_at)}</small></div>
            </List.Item>
          )}
        />
      </aside>

      <section className="chat-surface-v2">
        <div className="chat-surface-header"><div><Text strong>知识库问答</Text><Text type="secondary">检索范围按员工权限自动过滤 · 历史记录自动保存</Text></div></div>
        <div className="chat-thread-v2" ref={threadRef}>
          {!messages.length && !sending && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span>输入企业制度、合同或业务问题开始查询</span>} />}
          {messages.map((item) => (
            <div className={`chat-row-v2 ${item.role}`} key={item.id}><div className={`chat-bubble-v2 ${item.error ? 'error' : ''}`}>
              <div className="chat-meta-v2">{item.role === 'user' ? '我' : '知识助手'} · {item.at}</div><div className="chat-content-v2">{item.content}</div>
              {item.sources?.length ? <details className="chat-sources-v2"><summary>知识来源 {item.sources.length} 条</summary>{item.sources.map((source, index) => <div key={`${source.document_id || source.title}-${index}`}><strong>{source.document_name || source.title || `资料 ${index + 1}`}</strong><span className="chat-source-actions">{typeof source.score === 'number' && <span>相关度 {source.score.toFixed(3)}</span>}{source.can_download && source.erp_document_id ? <Button type="text" size="small" icon={<DownloadOutlined />} onClick={() => void downloadSource(source)}>下载原文</Button> : null}{source.content && <Button type="text" size="small" icon={<DownloadOutlined />} onClick={() => exportRetrievedContent(source)}>导出检索内容</Button>}</span>{source.content && <p>{source.content.slice(0, 180)}</p>}</div>)}</details> : null}
            </div></div>
          ))}
          {sending && <div className="chat-row-v2 assistant"><div className="chat-bubble-v2"><span className="typing-v2">正在检索并生成回答</span></div></div>}
        </div>
        <div className="chat-composer-v2"><Input.TextArea value={input} onChange={(event) => setInput(event.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} placeholder="输入问题，Enter 发送，Shift + Enter 换行" onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); void send(); } }} disabled={sending} /><Space className="chat-composer-actions-v2"><Text type="secondary">答案仅基于当前账号可访问的资料</Text><Button type="primary" icon={<SendOutlined />} loading={sending} onClick={() => void send()}>发送</Button></Space></div>
      </section>
      <BackendLoginModal open={authOpen} onAuthenticated={() => { setAuthOpen(false); void loadHistory(); }} />
    </div>
  );
}
