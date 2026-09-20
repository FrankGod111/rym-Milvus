import { apiUrl } from '@/config/deployment';
import type { AiExtractResult, Contract, ContractStage, ContractStatus, FieldExtraction } from '@/types';

export interface ContractQuery {
  stage?: ContractStage;
  status?: ContractStatus;
  q?: string;
}

interface BackendContract {
  id: string;
  code: string;
  party_a: string;
  party_b: string;
  sign_date: string | null;
  effective_date: string | null;
  expire_date: string | null;
  dept: string | null;
  handler: string | null;
  amount: number;
  subject: string | null;
  unit_price: number;
  tax_rate: number;
  payment_terms: string | null;
  deposit: number;
  deliverables: string | null;
  acceptance_standard: string | null;
  service_period: string | null;
  renewal_conditions: string | null;
  stage: ContractStage;
  status: ContractStatus;
  file_path?: string | null;
  ai_extracted?: AiExtractResult | null;
  created_at: string;
  updated_at: string;
}

interface ReviewResponse {
  sensitive: { word: string; found: boolean; suggestion: string }[];
  compliance: { regulation: string; compliant: boolean; note: string }[];
  risk_level: 'low' | 'medium' | 'high';
}

interface HistoryCompareResponse {
  peer_count: number;
  basis: Record<string, string>;
  results: Array<{
    field: string;
    current: string;
    avgHistory: string;
    deviation: string;
    advice: string;
    medianHistory?: string;
  }>;
  peer_samples: Array<{
    id: string;
    code: string;
    subject: string;
    amount: string;
    dept: string;
    stage: string;
    payment_terms: string;
  }>;
}

function toQuery(params?: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

function mapContract(contract: BackendContract): Contract {
  return {
    id: contract.id,
    code: contract.code,
    partyA: contract.party_a,
    partyB: contract.party_b,
    signDate: contract.sign_date || '',
    effectiveDate: contract.effective_date || '',
    expireDate: contract.expire_date || '',
    dept: contract.dept || '',
    handler: contract.handler || '',
    amount: Number(contract.amount || 0),
    subject: contract.subject || '',
    unitPrice: Number(contract.unit_price || 0),
    taxRate: Number(contract.tax_rate || 0),
    paymentTerms: contract.payment_terms || '',
    deposit: Number(contract.deposit || 0),
    deliverables: contract.deliverables || '',
    acceptanceStandard: contract.acceptance_standard || '',
    servicePeriod: contract.service_period || '',
    renewalConditions: contract.renewal_conditions || '',
    stage: contract.stage,
    status: contract.status,
    filePath: contract.file_path || undefined,
    aiExtracted: contract.ai_extracted || undefined,
    createdAt: contract.created_at,
    updatedAt: contract.updated_at,
  };
}

function toBackendPayload(contract: Partial<Contract>) {
  return {
    code: contract.code,
    party_a: contract.partyA,
    party_b: contract.partyB,
    sign_date: contract.signDate,
    effective_date: contract.effectiveDate,
    expire_date: contract.expireDate,
    dept: contract.dept,
    handler: contract.handler,
    amount: contract.amount,
    subject: contract.subject,
    unit_price: contract.unitPrice,
    tax_rate: contract.taxRate,
    payment_terms: contract.paymentTerms,
    deposit: contract.deposit,
    deliverables: contract.deliverables,
    acceptance_standard: contract.acceptanceStandard,
    service_period: contract.servicePeriod,
    renewal_conditions: contract.renewalConditions,
    stage: contract.stage,
    status: contract.status,
    ai_extracted: contract.aiExtracted,
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers || {}),
    },
    ...init,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json();
}

export async function fetchContracts(params?: ContractQuery): Promise<Contract[]> {
  const data = await request<BackendContract[]>(apiUrl(`/api/contracts${toQuery(params as Record<string, string | undefined>)}`));
  return data.map(mapContract);
}

export async function getContract(id: string): Promise<Contract> {
  const data = await request<BackendContract>(apiUrl(`/api/contracts/${id}`));
  return mapContract(data);
}

export async function createContract(contract: Partial<Contract>): Promise<Contract> {
  const data = await request<BackendContract>(apiUrl('/api/contracts'), {
    method: 'POST',
    body: JSON.stringify(toBackendPayload(contract)),
  });
  return mapContract(data);
}

export async function updateContract(id: string, contract: Partial<Contract>): Promise<Contract> {
  const payload = toBackendPayload(contract);
  Object.keys(payload).forEach((key) => payload[key as keyof typeof payload] === undefined && delete payload[key as keyof typeof payload]);
  const data = await request<BackendContract>(apiUrl(`/api/contracts/${id}`), {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return mapContract(data);
}

export async function deleteContract(id: string): Promise<void> {
  await request<void>(apiUrl(`/api/contracts/${id}`), { method: 'DELETE' });
}

export async function uploadContractFile(id: string, file: File): Promise<Contract> {
  const form = new FormData();
  form.append('file', file);
  const data = await request<BackendContract>(apiUrl(`/api/contracts/${id}/upload`), {
    method: 'POST',
    body: form,
  });
  return mapContract(data);
}

export async function runOCR(file: File): Promise<{ rawText: string; lines: { text: string; confidence: number }[] }> {
  const form = new FormData();
  form.append('file', file);
  const data = await request<{ raw_text: string; lines: { text: string; confidence: number }[] }>(apiUrl('/api/contracts/ai/ocr'), {
    method: 'POST',
    body: form,
  });
  return { rawText: data.raw_text, lines: data.lines };
}

export async function extractFields(rawText: string): Promise<FieldExtraction[]> {
  const data = await request<{ fields: FieldExtraction[] }>(apiUrl('/api/contracts/ai/extract'), {
    method: 'POST',
    body: JSON.stringify({ raw_text: rawText }),
  });
  return data.fields;
}

export async function reviewContract(text: string, fields: Record<string, any>): Promise<ReviewResponse> {
  return request<ReviewResponse>(apiUrl('/api/contracts/ai/review'), {
    method: 'POST',
    body: JSON.stringify({ text, fields }),
  });
}

export async function historyCompare(contract: Partial<Contract>): Promise<HistoryCompareResponse> {
  return request<HistoryCompareResponse>(apiUrl('/api/contracts/ai/history-compare'), {
    method: 'POST',
    body: JSON.stringify(contract),
  });
}

export interface ChatRequestPayload {
  query: string;
  user?: string;
  conversationId?: string;
  inputs?: Record<string, any>;
  difyBaseUrl?: string;
  difyAppApiKey?: string;
}

export interface ChatResponsePayload {
  answer: string;
  conversation_id: string;
  message_id: string;
  created_at?: number | string;
  raw?: any;
}

export async function chatWithAgent(payload: ChatRequestPayload): Promise<ChatResponsePayload> {
  return request<ChatResponsePayload>(apiUrl('/api/contracts/ai/chat'), {
    method: 'POST',
    body: JSON.stringify({
      query: payload.query,
      user: payload.user || 'contract-user',
      conversation_id: payload.conversationId || '',
      inputs: payload.inputs || {},
      difyBaseUrl: payload.difyBaseUrl,
      difyAppApiKey: payload.difyAppApiKey,
    }),
  });
}
