export type ContractStage = 'S4_确认' | 'S5_签订' | 'S6_履约' | 'completed';
export type ContractStatus = 'active' | 'pending' | 'completed' | 'risk';
export type RiskLevel = 'high' | 'medium' | 'low';

export interface Contract {
  id: string;
  code: string;
  partyA: string;
  partyB: string;
  signDate: string;
  effectiveDate: string;
  expireDate: string;
  dept: string;
  handler: string;
  amount: number;
  subject: string;
  unitPrice: number;
  taxRate: number;
  paymentTerms: string;
  deposit: number;
  deliverables: string;
  acceptanceStandard: string;
  servicePeriod: string;
  renewalConditions: string;
  stage: ContractStage;
  status: ContractStatus;
  filePath?: string;
  aiExtracted?: AiExtractResult;
  manualEdited?: Partial<Contract>;
  createdAt: string;
  updatedAt: string;
}

export interface AiExtractResult {
  id: string;
  fields: FieldExtraction[];
  rawText: string;
  sourceFile: string;
  extractedAt: string;
  reviewStatus: 'pending' | 'approved' | 'rejected';
}

export interface FieldExtraction {
  field: string;
  value: any;
  confidence: number;
  source?: string;
}

export interface RiskAlert {
  id: string;
  contractId: string;
  contractCode: string;
  level: RiskLevel;
  type: string;
  content: string;
  suggestion?: string;
  historyRef?: string;
  createdAt: string;
  resolved: boolean;
}

export interface DocVersion {
  version: string;
  filename: string;
  size: number;
  updatedAt: string;
  author: string;
  changelog: string;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  description: string;
  filename: string;
  fileType: string;
  size: number;
  folder: string;
  versions: DocVersion[];
  tags: string[];
  summary?: string;
  linkedSoftware?: string;
  permissions: {
    roles: string[];
    public: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CodeScanIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  type: string;
  message: string;
  file: string;
  line?: number;
  suggestion?: string;
}

export interface CodeScanResult {
  id: string;
  scanId: string;
  contractCode: string;
  apiKey: string;
  triggeredAt: string;
  issues: CodeScanIssue[];
  status: 'scanning' | 'completed' | 'failed';
}

export interface TestCase {
  id: string;
  title: string;
  contractCode: string;
  type: 'unit' | 'integration' | 'acceptance';
  status: 'passed' | 'failed' | 'pending' | 'skipped';
  coverage?: number;
  createdAt: string;
}

export interface OASyncConfig {
  id: string;
  platform: 'yonyou' | 'jd' | 'custom';
  enabled: boolean;
  syncType: 'realtime' | 'daily' | 'manual';
  endpoint: string;
  apiKey: string;
  apiSecret: string;
  fieldMappings: FieldMapping[];
  lastSyncAt?: string;
  lastSyncStatus?: 'success' | 'failed' | 'pending';
}

export interface FieldMapping {
  localField: string;
  remoteField: string;
  transform?: string;
}

export interface DashboardStats {
  totalContracts: number;
  activeContracts: number;
  riskContracts: number;
  expiringSoonContracts: number;
  thisMonthContracts: number;
  pendingReviews: number;
}
