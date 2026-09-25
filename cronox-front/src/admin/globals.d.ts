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

  interface CronoxApiError {
    name?: string;
    message: string;
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
    mailRequest?: (path: string, method?: string, body?: Record<string, unknown> | FormData) => Promise<unknown>;
    downloadExcel?: (module: string, query?: QueryRecord) => Promise<{ blob: Blob; filename: string }>;
    listCircleUpgradeRequests?: (queryOrStatus?: string | QueryRecord, queryOverride?: QueryRecord) => Promise<unknown>;
    approveCircleUpgrade?: (id: number | string, payload?: Record<string, unknown>) => Promise<unknown>;
    denyCircleUpgrade?: (id: number | string, payload?: Record<string, unknown>) => Promise<unknown>;
    listAutoCircleRequests?: (queryOrStatus?: string | QueryRecord, queryOverride?: QueryRecord) => Promise<unknown>;
    listAdminProducts?: (query?: QueryRecord) => Promise<unknown>;
    getInPersonPurchaseOptions?: (userId: number | string) => Promise<unknown>;
    createInPersonPurchase?: (userId: number | string, payload: Record<string, unknown>, idempotencyKey: string) => Promise<unknown>;
    voidInPersonPurchase?: (orderId: number | string, reason: string) => Promise<unknown>;
    getProductOrder?: () => Promise<unknown>;
    saveProductOrder?: (productIds: number[]) => Promise<unknown>;
    getAdminProduct?: (id: number | string) => Promise<unknown>;
    listInventory?: (query?: QueryRecord) => Promise<unknown>;
    getInventorySummary?: () => Promise<unknown>;
    getInventoryProduct?: (id: number | string) => Promise<unknown>;
    updateInventory?: (id: number | string, payload: Record<string, unknown>) => Promise<unknown>;
    getInventoryHistory?: (id: number | string, query?: QueryRecord) => Promise<unknown>;
    createAdminProduct?: (payload: Record<string, unknown>, idempotencyKey: string) => Promise<unknown>;
    updateAdminProduct?: (id: number | string, payload: Record<string, unknown>) => Promise<unknown>;
    deleteAdminProduct?: (id: number | string) => Promise<unknown>;
    deleteProductImage?: (productId: number | string, imageId: number | string, expectedUpdatedAt: string) => Promise<unknown>;
    updateProductCategories?: (id: number | string, categoryIds: number[]) => Promise<unknown>;
    listAdminCategories?: (query?: QueryRecord) => Promise<unknown>;
    uploadProductImages?: (files?: File[]) => Promise<unknown>;
    listPromoCodes?: (query?: QueryRecord) => Promise<unknown>;
    getAuditLogs?: (query?: QueryRecord) => Promise<unknown>;
    getUserDetail?: (id: number | string) => Promise<unknown>;
    getUserEditOptions?: () => Promise<unknown>;
    updateAdminUser?: (id: number | string, payload: Record<string, unknown>) => Promise<unknown>;
    getUserAuditLogs?: (id: number | string) => Promise<unknown>;
    getUserAnalyticsSummary?: (id: number | string) => Promise<unknown>;
    getUserAnalyticsProducts?: (id: number | string) => Promise<unknown>;
    getUserAnalyticsTimeline?: (id: number | string, query?: QueryRecord) => Promise<unknown>;
    getUserLoginHistory?: (id: number | string, query?: QueryRecord) => Promise<unknown>;
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
    getCsrfHeaders: () => Promise<Record<string, string>>;
    classifyApiError: (error?: unknown) => CronoxApiErrorClassification;
    logout: () => Promise<unknown>;
    getMe: () => Promise<{ role?: string; [key: string]: unknown } | null>;
    getProducts?: (query?: QueryRecord) => Promise<unknown[]>;
    getProductsPage?: (query?: QueryRecord) => Promise<{
      products: unknown[];
      meta: Record<string, unknown>;
    }>;
    getProductSuggestions?: (search: string, query?: QueryRecord) => Promise<unknown[]>;
    getCategoryProducts?: (slug: string, query?: QueryRecord) => Promise<unknown>;
    admin?: CronoxAdminApi;
    [key: string]: unknown;
  }

  interface CronoxSecurity {
    escapeHtml: (value: unknown) => string;
    externalHttpUrl: (value: unknown) => string;
    productImageUrl: (value: unknown, fallback?: string) => string;
  }

  interface Window {
    CRONOX_ADMIN_AUTH?: {
      currentReturnTo: () => string;
      isAdmin: (user: { role?: string } | null | undefined) => boolean;
      loginUrl: (returnTo?: string) => string;
      normalizeRole: (role: unknown) => string;
      redirectToLogin: (returnTo?: string) => void;
      safeReturnTo: (candidate?: string | null) => string;
    };
    CRONOX_STOCK?: {
      decoratePurchase: (price: HTMLElement, button: HTMLButtonElement, product: Record<string, unknown>) => void;
      availableStock: (variants: unknown) => number;
      classifyStock: (total: number) => string;
      decorateCard: (card: HTMLElement, price: HTMLElement, product: Record<string, unknown>) => void;
    };
    CRONOX_API?: CronoxApi;
    CRONOX_API_BASE?: string;
    CRONOX_UI?: CronoxUi;
    CRONOX_SECURITY?: CronoxSecurity;
    CRONOX_SIZES?: {
      key?: (input: unknown) => string;
      label?: (input: unknown) => string;
      order?: (input: unknown) => number;
    };
    CRONOX_TRUSTED_IMAGE_ORIGINS?: string[];
    __CRONOX_API_BASE__?: string;
    __CRONOX_BACKEND_PORT__?: string | number;
  }
}
