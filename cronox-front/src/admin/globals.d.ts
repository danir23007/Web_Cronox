export {};

declare global {
  type QueryValue = string | number | boolean;
  type QueryParam = QueryValue | null | undefined;
  type QueryRecord = Record<string, QueryParam | QueryParam[]>;

  interface AdminUserRequestItem {
    id: number | string;
    kind: '2-3' | '3-4';
    status: string;
    fromCircle: number;
    toCircle: number;
    createdAt: string;
    resolvedAt: string | null;
    resolvedBy?: { id: number; email?: string | null } | null;
    reason?: string | null;
  }

  interface AdminUserRequestsResponse {
    items: AdminUserRequestItem[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }

  interface AdminUserOrderItem {
    id: number | string;
    status: string;
    totalCents: number;
    currency: string;
    createdAt: string;
    itemsCount: number;
  }

  interface AdminUserOrdersResponse {
    items: AdminUserOrderItem[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }

  interface CronoxApiError extends Error {
    status?: number;
    statusCode?: number;
    endpoint?: string;
    payload?: unknown;
  }

  interface CronoxApiErrorClassification {
    kind: string;
    severity: 'error' | 'warning' | 'info';
    userMessage: string;
    isRetryable: boolean;
  }

  interface CronoxBannerAction {
    label: string;
    onClick?: () => void;
    href?: string;
    variant?: string;
  }

  interface CronoxBannerOptions {
    type?: string;
    title?: string;
    message?: string;
    details?: Record<string, unknown> | null;
    actions?: CronoxBannerAction[];
    colSpan?: number;
    emptyTitle?: string;
    emptyMessage?: string;
  }

  interface CronoxEmptyStateOptions {
    title?: string;
    message?: string;
    actions?: CronoxBannerAction[];
    colSpan?: number;
  }

  interface CronoxUi {
    renderBanner?: (container: Element, options: CronoxBannerOptions) => void;
    renderEmptyState?: (container: Element, options: CronoxEmptyStateOptions) => void;
    setLoading?: (container: Element, isLoading: boolean, options?: { title?: string; colSpan?: number }) => void;
  }

  interface CronoxAdminApi {
    getDashboard?: () => Promise<unknown>;
    listCircleUpgradeRequests?: (queryOrStatus?: string | QueryRecord, queryOverride?: QueryRecord) => Promise<unknown>;
    approveCircleUpgrade?: (id: number | string, payload?: Record<string, unknown>) => Promise<unknown>;
    denyCircleUpgrade?: (id: number | string, payload?: Record<string, unknown>) => Promise<unknown>;
    listAutoCircleRequests?: (queryOrStatus?: string | QueryRecord, queryOverride?: QueryRecord) => Promise<unknown>;
    listAdminProducts?: (query?: QueryRecord) => Promise<unknown>;
    getAdminProduct?: (id: number | string) => Promise<unknown>;
    createAdminProduct?: (payload: Record<string, unknown>) => Promise<unknown>;
    updateAdminProduct?: (id: number | string, payload: Record<string, unknown>) => Promise<unknown>;
    deleteAdminProduct?: (id: number | string) => Promise<unknown>;
    uploadProductImages?: (files?: File[]) => Promise<unknown>;
    listPromoCodes?: (query?: QueryRecord) => Promise<unknown>;
    getAuditLogs?: (query?: QueryRecord) => Promise<unknown>;
    getUserDetail?: (id: number | string) => Promise<unknown>;
    getUserAuditLogs?: (id: number | string) => Promise<unknown>;
    getUserRequests?: (id: number | string, query?: QueryRecord) => Promise<AdminUserRequestsResponse>;
    getUserOrders?: (id: number | string, query?: QueryRecord) => Promise<AdminUserOrdersResponse>;
    listAdminOrders?: (query?: QueryRecord) => Promise<unknown>;
    listUsers?: (query?: QueryRecord) => Promise<unknown>;
    getUserList?: (query?: QueryRecord) => Promise<unknown>;
    listAdminNotes?: (query?: QueryRecord) => Promise<unknown>;
    createAdminNote?: (payload: Record<string, unknown>) => Promise<unknown>;
    updateAdminNote?: (id: number | string, payload: Record<string, unknown>) => Promise<unknown>;
    deleteAdminNote?: (id: number | string) => Promise<unknown>;
    createPromoCode?: (payload: Record<string, unknown>) => Promise<unknown>;
    updatePromoCode?: (id: number | string, payload: Record<string, unknown>) => Promise<unknown>;
    deletePromoCode?: (id: number | string) => Promise<unknown>;
    listUserOrders?: (id: number | string, query?: QueryRecord) => Promise<unknown>;
    listUserRequests?: (id: number | string, query?: QueryRecord) => Promise<unknown>;
  }

  interface CronoxApi {
    API_BASE: string;
    formatPrice: (value: number) => string;
    getFallbackProducts: () => unknown[];
    classifyApiError: (error?: unknown) => CronoxApiErrorClassification;
    admin?: CronoxAdminApi;
    [key: string]: unknown;
  }

  interface Window {
    CRONOX_API?: CronoxApi;
    CRONOX_API_BASE?: string;
    CRONOX_UI?: CronoxUi;
    __CRONOX_API_BASE__?: string;
    __CRONOX_BACKEND_PORT__?: string | number;
  }
}
