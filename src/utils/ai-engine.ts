import type { AiExtractResult, FieldExtraction, RiskAlert, Contract, CodeScanResult } from '@/types';
import { extractFields, historyCompare, reviewContract, runOCR } from '@/api/contracts';

// ==================== AI Engine ====================

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// OCR
export async function simulateOCR(file: File): Promise<AiExtractResult> {
  const result = await runOCR(file);
  const fields = await extractFields(result.rawText);
  return {
    id: `ae-${Date.now()}`,
    fields,
    rawText: result.rawText,
    sourceFile: file.name,
    extractedAt: new Date().toISOString(),
    reviewStatus: 'pending',
  };
}

// Contract info extraction
export async function extractContractInfo(rawText: string): Promise<FieldExtraction[]> {
  return extractFields(rawText);
}

// Sensitive word check
export async function checkSensitiveWords(text: string): Promise<{ word: string; found: boolean; suggestion: string }[]> {
  const result = await reviewContract(text, {});
  return result.sensitive;
}

// Regulation compliance check
export async function checkRegulationCompliance(contract: Partial<Contract>): Promise<{ regulation: string; compliant: boolean; note: string }[]> {
  const result = await reviewContract(JSON.stringify(contract), contract as Record<string, any>);
  return result.compliance;
}

// Price/historical comparison
export async function compareWithHistory(contract: Partial<Contract>): Promise<{ field: string; current: string; avgHistory: string; deviation: string; advice: string }[]> {
  const result = await historyCompare(contract);
  return result.results;
}

// Risk alert generation
export async function generateRiskAlerts(contracts: Contract[]): Promise<RiskAlert[]> {
  await delay(100);
  const alerts: RiskAlert[] = [];
  contracts.forEach((c) => {
    if (c.status === 'completed') return;
    const diffDays = (new Date(c.expireDate).getTime() - new Date().getTime()) / 86400000;
    if (diffDays < 0) {
      alerts.push({
        id: `ra-${Date.now()}-${c.id}-1`,
        contractId: c.id,
        contractCode: c.code,
        level: 'high',
        type: '到期预警',
        content: `合同 ${c.code} 已逾期 ${Math.abs(Math.floor(diffDays))} 天，需立即处理`,
        suggestion: '立即联系客户确认状态，启动法律或业务补救流程',
        createdAt: new Date().toISOString(),
        resolved: false,
      });
    } else if (diffDays < 60) {
      alerts.push({
        id: `ra-${Date.now()}-${c.id}-2`,
        contractId: c.id,
        contractCode: c.code,
        level: diffDays < 30 ? 'high' : 'medium',
        type: '到期预警',
        content: `合同 ${c.code} 将于 ${Math.floor(diffDays)} 天后到期`,
        suggestion: '提前安排续约谈判或服务交接',
        createdAt: new Date().toISOString(),
        resolved: false,
      });
    }
    if (c.amount > 1000000 && c.stage !== 'S6_履约') {
      alerts.push({
        id: `ra-${Date.now()}-${c.id}-3`,
        contractId: c.id,
        contractCode: c.code,
        level: 'medium',
        type: '大额合同提醒',
        content: `合同 ${c.code} 金额 ¥${c.amount.toLocaleString()}，当前处于 ${c.stage} 阶段`,
        suggestion: '大额合同建议增加阶段性审核节点',
        createdAt: new Date().toISOString(),
        resolved: false,
      });
    }
  });
  return alerts;
}

// Knowledge doc summary + tags
export async function generateDocSummary(content: string): Promise<{ summary: string; tags: string[] }> {
  await delay(1500);
  const sentences = content.split(/[。\n]/).filter(Boolean);
  const summary = sentences.slice(0, 3).join('。') + '。';
  const tags = ['文档', '系统'];
  if (content.includes('规范') || content.includes('标准')) tags.push('规范');
  if (content.includes('评审')) tags.push('评审');
  if (content.includes('接口') || content.includes('API')) tags.push('接口');
  if (content.includes('安全')) tags.push('安全');
  if (content.includes('设计')) tags.push('设计');
  return { summary, tags: [...new Set(tags)] };
}

// Code scan simulation
export async function simulateCodeScan(contractCode: string, apiKey: string): Promise<CodeScanResult> {
  await delay(2500);
  const issuePool = [
    { severity: 'error' as const, type: '安全', message: '发现硬编码 API Key 或凭证', file: 'config/secrets.ts', line: 7, suggestion: '请将敏感信息移至环境变量或密钥管理系统' },
    { severity: 'warning' as const, type: '性能', message: 'API 响应时间超过阈值 1.5s', file: 'api/query.ts', line: 23, suggestion: '建议添加缓存层或优化数据库查询语句' },
    { severity: 'warning' as const, type: '依赖', message: '依赖包存在 CVE 已知漏洞', file: 'package.json', line: 18, suggestion: '建议升级相关依赖至安全版本' },
    { severity: 'info' as const, type: '规范', message: '类型定义不够严格，建议使用更精确的类型', file: 'types/common.ts', line: 5, suggestion: '使用 `type` 替代 `any`，提升类型安全性' },
    { severity: 'info' as const, type: '规范', message: '缺少 JSDoc 注释', file: 'utils/helper.ts', line: 11, suggestion: '为导出函数添加 JSDoc 注释，提升可维护性' },
  ];

  const count = 2 + Math.floor(Math.random() * 2);
  const shuffled = [...issuePool].sort(() => Math.random() - 0.5);
  const issues = shuffled.slice(0, count).map((iss, i) => ({
    id: `iss-${Date.now()}-${i}`,
    ...iss,
  }));

  return {
    id: `cs-${Date.now()}`,
    scanId: `scan-${Date.now().toString().slice(-6)}`,
    contractCode,
    apiKey: apiKey.slice(0, 8) + '****',
    triggeredAt: new Date().toISOString(),
    issues,
    status: 'completed',
  };
}

// OA sync simulation
export async function simulateOASync(config: import('@/types').OASyncConfig): Promise<{ synced: number; failed: number; details: string[] }> {
  await delay(2000);
  const synced = Math.floor(config.fieldMappings.length * (0.6 + Math.random() * 0.4));
  const failed = config.fieldMappings.length - synced;
  const details = config.fieldMappings.map((m) => ({
    field: m.remoteField,
    status: Math.random() > 0.3 ? 'success' as const : 'failed' as const,
    message: Math.random() > 0.3 ? '同步成功' : '远程系统字段格式不匹配，请检查映射配置',
  }));
  return { synced, failed, details: details.map((d) => `${d.field}: ${d.message}`) };
}
