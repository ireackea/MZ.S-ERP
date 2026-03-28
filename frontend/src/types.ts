// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27

export type UnitType = string;
export type CategoryType = string;

export type OperationType = string;
export type PartnerType = 'supplier' | 'customer';
export type OrderType = 'purchase' | 'sale';
export type OrderStatus = 'pending' | 'completed' | 'cancelled';

export type UserRole = string;
export type UserStatus = 'active' | 'suspended' | 'locked';
export type DataScope = 'all' | 'warehouse_a' | 'warehouse_b' | string;

export type ItemSortMode =
  | 'manual_locked'
  | 'name_asc'
  | 'name_desc'
  | 'code_asc'
  | 'category_then_name';

export interface ItemSortSettings {
  mode: ItemSortMode;
  manualOrder: string[];
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface SystemSettings {
  companyName: string;
  currency: string;
  address: string;
  phone: string;
  logoUrl?: string;
  defaultUnloadingDuration?: number;
  defaultDelayPenalty?: number;
}

export interface OperationAppearance {
  type: OperationType;
  color: string;
  fontFamily?: string;
  fontSize?: string;
}

export interface ReportColumnConfig {
  key: string;
  label: string;
  isVisible: boolean;
}

export interface UnloadingRule {
  id: string;
  name?: string;
  rule_name?: string;
  durationMinutes?: number;
  allowed_duration_minutes?: number;
  delayPenaltyPerMinute?: number;
  unloading_duration_minutes?: number;
  penalty_rate_per_minute?: number;
  is_active?: boolean;
}

export interface Item {
  id: string;
  publicId?: string;
  code?: string;
  barcode?: string;
  name: string;
  englishName?: string;
  category: CategoryType;
  zone?: string;
  unit: UnitType;
  minLimit: number;
  maxLimit: number;
  orderLimit?: number;
  packageWeight?: number;
  currentStock: number;
  tags?: string[];
  lastUpdated?: string;
  costPrice?: number;
  co2PerUnit?: number;
  waterUsagePerUnit?: number;
  sustainabilityRating?: 'A' | 'B' | 'C' | 'D';
  warehouseId?: DataScope;
}

export interface Transaction {
  id: string;
  publicId?: string;
  createdByUserId?: string;
  warehouseId?: DataScope;
  date: string;
  itemId: string;
  type: OperationType;
  quantity: number;
  supplierNet?: number;
  difference?: number;
  packageCount?: number;
  warehouseInvoice: string;
  supplierInvoice?: string;
  weightSlip?: string;
  supplierOrReceiver: string;
  truckNumber?: string;
  trailerNumber?: string;
  driverName?: string;
  entryTime?: string;
  exitTime?: string;
  unloadingRuleId?: string;
  unloadingDuration?: number;
  delayDuration?: number;
  delayPenalty?: number;
  calculatedFine?: number;
  notes?: string;
  attachmentData?: string;
  attachmentName?: string;
  attachmentType?: string;
  googleDriveLink?: string;
  timestamp: number;
}

export interface StockCheck {
  id: string;
  date: string;
  itemId: string;
  systemBalance: number;
  actualBalance: number;
  difference: number;
  periodStart?: string;
  periodEnd?: string;
  openingSystemBalance?: number;
  openingActualBalance?: number;
  movementsIn?: number;
  movementsOut?: number;
  movementsNet?: number;
  expectedFinalBalance?: number;
  varianceType?: 'surplus' | 'shortage' | 'match';
  openingAdjusted?: boolean;
}

export interface Partner {
  id: string;
  name: string;
  type: PartnerType;
  phone: string;
  address?: string;
  notes?: string;
}

export interface OrderItem {
  itemId: string;
  quantity: number;
  unit: UnitType;
}

export interface Order {
  id: string;
  createdByUserId?: string;
  warehouseId?: DataScope;
  orderNumber: string;
  type: OrderType;
  partnerId: string;
  date: string;
  status: OrderStatus;
  items: OrderItem[];
  totalAmount?: number;
  notes?: string;
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
  roleId?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  active: boolean;
  isActive?: boolean;
  status?: UserStatus;
  scope?: DataScope;
  userBranch?: string;
  permissions?: string[];
  twoFactorEnabled?: boolean;
  twoFaEnabled?: boolean;
  mustChangePassword?: boolean;
  googleId?: string;
  avatarUrl?: string;
}

export interface FormulaItem {
  itemId: string;
  percentage: number;
  weightPerTon: number;
}

export interface Formula {
  id: string;
  name: string;
  code: string;
  targetProductId: string;
  items: FormulaItem[];
  expectedCostPerTon?: number;
  notes?: string;
  isActive: boolean;
}

export interface AuditLog {
  id: string;
  timestamp: number;
  userId: string;
  userName: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'EXPORT';
  entity: 'ITEM' | 'TRANSACTION' | 'ORDER' | 'Partner' | 'FORMULA' | 'USER';
  details: string;
  ipHash?: string;
}

export interface GridColumnPreference {
  key: string;
  label: string;
  visible: boolean;
  order: number;
  width?: number;
  frozen?: boolean;
  locked?: boolean;
}

export interface UserGridPreference {
  user_id: string;
  module_key: string;
  config_json: string;
}

export interface PermissionDefinition {
  id: string;
  module: string;
  resource: string;
  action: 'view' | 'create' | 'update' | 'delete' | 'export' | string;
  label: string;
}

export interface RoleDefinition {
  id: string;
  name: string;
  description?: string;
  permissionIds: string[];
}

export interface IamConfig {
  permissions: PermissionDefinition[];
  roles: RoleDefinition[];
  updatedAt: number;
}

export interface UserSession {
  id: string;
  userId: string;
  browser: string;
  deviceType: string;
  ipAddress: string;
  lastActivityAt: number;
  revoked: boolean;
  isCurrent: boolean;
}

export interface UserActivityLog {
  id: string;
  timestamp: number;
  userId: string;
  userName: string;
  event:
    | 'login'
    | 'logout'
    | 'access_denied'
    | 'data_export'
    | 'data_import'
    | 'login_success'
    | 'user_created'
    | 'user_updated'
    | 'user_deleted'
    | string;
  details: string;
  ipAddress?: string;
}
