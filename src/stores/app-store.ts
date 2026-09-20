import { create } from 'zustand';
import type { Contract, KnowledgeDoc, ContractStage, ContractStatus, RiskAlert } from '@/types';
import { mockRiskAlerts as initialRiskAlerts, mockKnowledgeDocs as initialKnowledgeDocs } from '@/api/mock-data';
import {
  createContract as createContractApi,
  deleteContract as deleteContractApi,
  fetchContracts,
  updateContract as updateContractApi,
} from '@/api/contracts';
import type { ErpUser } from '@/api/erp';

// --- App Store (Zustand) ---

interface AppStore {
  // User
  currentUser: { name: string; role: 'admin' | 'manager' | 'user'; erp?: ErpUser; permissions: string[]; menuPermissions: Record<string, boolean> };
  authenticated: boolean;
  setErpUser: (user: ErpUser, permissions?: string[], menuPermissions?: Record<string, boolean>) => void;
  setAuthenticated: (value: boolean) => void;
  login: (role: 'admin' | 'manager' | 'user') => void;
  logout: () => void;

  // Contracts
  contracts: Contract[];
  selectedContractId: string | null;
  contractsLoaded: boolean;
  setSelectedContract: (id: string) => void;
  loadContracts: () => Promise<void>;
  refreshContracts: () => Promise<void>;
  updateContractStage: (id: string, stage: ContractStage) => Promise<void>;
  updateContractStatus: (id: string, status: ContractStatus) => Promise<void>;
  saveContract: (contract: Partial<Contract>) => Promise<Contract>;
  addContract: (contract: Contract) => void;
  removeContract: (id: string) => Promise<void>;

  // Risk Alerts
  riskAlerts: RiskAlert[];
  setRiskAlerts: (alerts: RiskAlert[]) => void;

  // Knowledge
  knowledgeDocs: KnowledgeDoc[];
  setKnowledgeDocs: (docs: KnowledgeDoc[]) => void;

  // Global
  notifications: { id: string; message: string; type: 'success' | 'warning' | 'error' | 'info' }[];
  addNotification: (message: string, type?: 'success' | 'warning' | 'error' | 'info') => void;
  removeNotification: (id: string) => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  // User
  currentUser: { name: '管理员', role: 'admin', permissions: ['*'], menuPermissions: {} },
  authenticated: Boolean(sessionStorage.getItem('rym-erp-access-token')),
  setErpUser: (user, permissions = user.role?.permissions || [], menuPermissions = {}) => set({ currentUser: { name: user.name, role: user.is_admin ? 'admin' : 'user', erp: user, permissions, menuPermissions } }),
  setAuthenticated: (value) => set({ authenticated: value }),
  login: (role) => set({ authenticated: true, currentUser: { name: role === 'admin' ? '管理员' : role === 'manager' ? '项目经理' : '普通用户', role, permissions: role === 'admin' ? ['*'] : ['document:read'], menuPermissions: {} } }),
  logout: () => set({ authenticated: false, currentUser: { name: '', role: 'user', permissions: [], menuPermissions: {} } }),

  // Contracts
  contracts: [],
  selectedContractId: null,
  contractsLoaded: false,
  setSelectedContract: (id) => set({ selectedContractId: id }),
  loadContracts: async () => {
    const contracts = await fetchContracts();
    set({ contracts, contractsLoaded: true });
  },
  refreshContracts: async () => {
    const contracts = await fetchContracts();
    set({ contracts, contractsLoaded: true });
  },
  updateContractStage: async (id, stage) => {
    const updated = await updateContractApi(id, { stage });
    set({ contracts: get().contracts.map((c) => (c.id === id ? updated : c)) });
  },
  updateContractStatus: async (id, status) => {
    const updated = await updateContractApi(id, { status });
    set({ contracts: get().contracts.map((c) => (c.id === id ? updated : c)) });
  },
  saveContract: async (contract) => {
    const saved = contract.id
      ? await updateContractApi(contract.id, contract)
      : await createContractApi(contract);
    set({
      contracts: contract.id
        ? get().contracts.map((c) => (c.id === saved.id ? saved : c))
        : [saved, ...get().contracts],
    });
    return saved;
  },
  addContract: (contract) =>
    set({
      contracts: [contract, ...get().contracts.filter((c) => c.id !== contract.id)],
    }),
  removeContract: async (id) => {
    await deleteContractApi(id);
    set({ contracts: get().contracts.filter((c) => c.id !== id) });
  },

  // Risk Alerts
  riskAlerts: initialRiskAlerts,
  setRiskAlerts: (alerts) => set({ riskAlerts: alerts }),

  // Knowledge
  knowledgeDocs: initialKnowledgeDocs,
  setKnowledgeDocs: (docs) => set({ knowledgeDocs: docs }),

  // Global notifications
  notifications: [],
  addNotification: (message, type = 'info') => {
    const id = `n-${Date.now()}`;
    set({ notifications: [...get().notifications, { id, message, type }] });
    setTimeout(() => get().removeNotification(id), 5000);
  },
  removeNotification: (id) => set({ notifications: get().notifications.filter((n) => n.id !== id) }),
}));
