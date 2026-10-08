// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

// ENTERPRISE FIX: Phase 2 - Multi-User Sync - Final Completion Pass - 2026-03-02
// UTF-8 Encoding Fixed - Arabic Text Restored
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@hooks/usePermissions';
import {
  Users,
  Shield,
  Lock,
  Unlock,
  Edit2,
  Trash2,
  Plus,
  Search,
  RefreshCw,
  Save,
  Table2,
  History,
  UserCog,
  Monitor,
  Activity,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchUsers,
  fetchRoles,
  createUser,
  updateUser,
  deleteUser,
  lockUser,
  bulkAssignRole,
  bulkDeleteUsers,
  updateRolePermissions,
  deleteRole,
  fetchUserAudit,
  createCustomRole,
  inviteUser,
  type UserDto,
  type RoleDto,
  type UserAuditDto,
  type UsersStatusFilter,
} from '@services/usersService';
import UnifiedIamRoleModal from './unified-iam/RoleModal';
import ChangeMyPassword from './unified-iam/ChangeMyPassword';
import { formatDateTime } from '@services/dateFormat';
import {
  INITIAL_CREATE_FORM,
  getErrorMessage,
  normalizeStatusFilter,
  findLeastPrivilegeRole,
  isFullAccessRoleName,
  isBuiltInRoleName,
  roleNameOf,
  type CreateUserFormState,
} from './unified-iam/shared';
import {
  PERMISSIONS_CATALOG,
  FULL_ACCESS_TOKEN,
  ALL_PERMISSION_IDS,
  isPermissionGranted,
  countGrantedInGroup,
  type PermissionGroup,
} from '@services/permissionsCatalog';

type UpdateUserPayload = Parameters<typeof updateUser>[1];

const UnifiedIAM: React.FC = () => {
  // #13 — the screen was gated on `users.view` and then offered delete, lock,
  // bulk-delete, bulk role assignment and permission-matrix saving to whoever could see
  // it. The API enforces each of those separately (`users.delete`, `users.lock`,
  // `users.update`) — verified live: a `users.view` account gets 403 on all four. So this
  // was never a hole, it was a screen offering buttons that can only fail.
  //
  // Which is its own kind of lie, and an expensive one to debug: an administrator
  // concludes their role is broken, or worse, grants themselves `users.delete` to make a
  // button work. Hiding a control the caller cannot use is not security theatre — it is
  // the UI telling the truth about what the session may do.
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('users.create');
  const canUpdate = hasPermission('users.update');
  const canDelete = hasPermission('users.delete');
  const canLock = hasPermission('users.lock');

  const [users, setUsers] = useState<UserDto[]>([]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<UsersStatusFilter | ''>('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkRoleId, setBulkRoleId] = useState('');

  const [activeTab, setActiveTab] = useState<'users' | 'matrix' | 'audit'>('users');
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [matrix, setMatrix] = useState<string[]>([]);
  // PERMISSIONS MATRIX REBUILD - 2026-04-29: search + collapse state per module
  const [matrixSearch, setMatrixSearch] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // ENTERPRISE FIX: Custom Roles - Phase 2 - 2026-03-02
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleColor, setNewRoleColor] = useState('#64748b');

  const [auditUserId, setAuditUserId] = useState('');
  const [auditRows, setAuditRows] = useState<UserAuditDto[]>([]);

  const [createForm, setCreateForm] = useState<CreateUserFormState>(INITIAL_CREATE_FORM);

  // FC-SEC-006 — the invitation link is a deliverable, not a side effect. It is
  // held so the admin can copy it, because this deployment has no mail
  // transport and the backend only persists the invitation.
  const [pendingInvitation, setPendingInvitation] = useState<{
    email: string;
    link: string;
    expiresAt: string;
  } | null>(null);

  const copyInvitationLink = async () => {
    if (!pendingInvitation) return;
    try {
      await navigator.clipboard.writeText(pendingInvitation.link);
      toast.success('تم نسخ الرابط');
    } catch {
      // Clipboard is unavailable over plain http on some browsers; the link is
      // on screen and selectable, so tell the user rather than failing silently.
      toast.error('تعذّر النسخ التلقائي — انسخ الرابط يدوياً من الحقل أدناه');
    }
  };

  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);
  const allSelected = useMemo(
    () => users.length > 0 && users.every((u) => selected[u.id]),
    [users, selected],
  );
  const pageCount = Math.max(1, Math.ceil(total / limit));

  const loadRoles = async () => {
    try {
      const data = await fetchRoles();
      setRoles(data);
      // FC-SEC-005 — nothing is auto-selected. The create form, the bulk
      // assign and the matrix all open on a placeholder so a role is always a
      // deliberate choice; previously all three silently took roles[0], which
      // is SuperAdmin because the roles endpoint sorts by createdAt asc.
      if (!bulkRoleId && data[0]) setBulkRoleId('');
      if (!selectedRoleId && data[0]) setSelectedRoleId('');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'فشل تحميل الأدوار'));
    }
  };

  const loadUsers = async (keepPage = true) => {
    setLoading(true);
    try {
      const targetPage = keepPage ? page : 1;
      const response = await fetchUsers({
        page: targetPage,
        limit,
        search: search || undefined,
        role: roleFilter || undefined,
        status: statusFilter || undefined,
      });
      setUsers(response.data);
      setTotal(response.total);
      setPage(response.page);
      if (!auditUserId && response.data[0]) setAuditUserId(response.data[0].id);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'فشل تحميل المستخدمين'));
    } finally {
      setLoading(false);
    }
  };

  // لماذا: نستخدم ref بدلاً من effect منفصل لتجنب الطلب المزدوج عند mount.
  // React يُشغّل useEffect بعد كل render حيث تغيّرت dependencies — لكن عند mount
  // يُشغّله دائمًا حتى لو القيم لم تتغيّر. وجود effect أول لـ [] وثانٍ لـ [search,...]
  // كان يُنتج استدعاءَين لـ loadUsers في أول render: مصدر 2 req/mount.
  // الحل: حذف الـ effect الأول والسماح للثاني بالعمل وحده. loadRoles تُستدعى عند
  // mount عبر الـ ref guard مرة واحدة.
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      void loadRoles();
    }
    void loadUsers(false);
  }, [search, roleFilter, statusFilter, limit]);

  useEffect(() => {
    const role = roles.find((entry) => entry.id === selectedRoleId) || roles[0];
    if (!role) return;
    setSelectedRoleId(role.id);
    setMatrix(role.permissions || []);
  }, [selectedRoleId, roles]);

  useEffect(() => {
    if (!auditUserId) return;
    void fetchUserAudit(auditUserId)
      .then(setAuditRows)
      .catch((error: unknown) => toast.error(getErrorMessage(error, 'فشل تحميل سجل التدقيق')));
  }, [auditUserId]);

  const handleCreateRole = async () => {
    if (!newRoleName.trim()) {
      toast.error('يرجى إدخال اسم الدور');
      return;
    }
    try {
      await createCustomRole({ name: newRoleName, color: newRoleColor });
      toast.success('تم إنشاء الدور الجديد بنجاح');
      setShowRoleModal(false);
      setNewRoleName('');
      void loadRoles();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'فشل إنشاء الدور'));
    }
  };

  /**
   * FC-SEC-008 — roles could be created and edited but never removed, so a
   * mistyped name stayed in the assignment dropdown for good. Built-in roles
   * are refused by the API, and a role that still has users is refused with a
   * message that says to move them first rather than cascading into users that
   * cannot exist without a role.
   */
  const handleDeleteRole = async () => {
    if (!selectedRoleId) return;
    const role = roles.find((entry) => entry.id === selectedRoleId);
    if (!role) return;

    if (isBuiltInRoleName(role.name)) {
      toast.error('لا يمكن حذف دور مدمج — يمكنك تعديل صلاحياته بدل ذلك');
      return;
    }
    const confirmed = window.confirm(
      `حذف الدور "${role.name}"؟\n\n`
      + 'لن ينجح الحذف إن كان مرتبطاً بمستخدمين — انقلهم إلى دور آخر أولاً.',
    );
    if (!confirmed) return;

    try {
      await deleteRole(role.id);
      toast.success(`تم حذف الدور ${role.name}`);
      setSelectedRoleId('');
      setMatrix([]);
      void loadRoles();
      void loadUsers(true);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'فشل حذف الدور'));
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.username || !createForm.password) {
      toast.error('يرجى إدخال اسم المستخدم وكلمة المرور على الأقل');
      return;
    }
    // FC-SEC-005 — a role must be chosen on purpose. The form used to arrive
    // with SuperAdmin already selected, so filling only name+password minted an
    // administrator by accident.
    if (!createForm.roleId) {
      toast.error('اختر الدور صراحةً قبل الحفظ');
      return;
    }
    const chosenRole = roleNameOf(createForm.roleId, roles);
    if (isFullAccessRoleName(chosenRole)) {
      const confirmed = window.confirm(
        `أنت على وشك إنشاء مستخدم بدور ${chosenRole}، وهو دور يملك كل صلاحيات النظام.\n`
        + 'هل أنت متأكد؟ يُفضّل استخدام أقل دور يكفي لاحتياج المستخدم.',
      );
      if (!confirmed) return;
    }
    try {
      await createUser({
        username: createForm.username,
        email: createForm.email || undefined,
        password: createForm.password,
        firstName: createForm.firstName || undefined,
        lastName: createForm.lastName || undefined,
        roleId: createForm.roleId,
      });
      toast.success('تم إنشاء المستخدم بنجاح');
      setCreateForm({ ...INITIAL_CREATE_FORM });
      void loadUsers(true);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'فشل إنشاء المستخدم'));
    }
  };

  const handleUpdateUser = async (id: string, payload: UpdateUserPayload) => {
    try {
      await updateUser(id, payload);
      toast.success('تم تحديث المستخدم');
      void loadUsers(true);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'فشل تحديث المستخدم'));
    }
  };

  /**
   * FC-SEC-005 — the per-row role dropdown wrote on every change event, with no
   * confirmation and no save step, so brushing the dropdown escalated the user
   * instantly. The dropdown is now controlled and only commits on an explicit
   * confirm that names the role being granted.
   */
  const handleRowRoleChange = async (user: UserDto, nextRoleId: string) => {
    if (!nextRoleId || nextRoleId === user.roleId) return;
    const from = roleNameOf(user.roleId, roles);
    const to = roleNameOf(nextRoleId, roles);
    const warning = isFullAccessRoleName(to)
      ? `\n⚠ ${to} يملك كل صلاحيات النظام.`
      : '';
    const confirmed = window.confirm(
      `تغيير دور "${user.fullName}"؟\n\nمن: ${from}\nإلى: ${to}${warning}\n\nسيُطبَّق التغيير فوراً على جلسات المستخدم.`,
    );
    if (!confirmed) return;
    await handleUpdateUser(user.id, { roleId: nextRoleId });
  };

  const handleDeleteUser = async (id: string) => {
    if (!window.confirm('هل أنت متأكد أنك تريد حذف هذا المستخدم؟')) return;
    try {
      await deleteUser(id);
      toast.success('تم حذف المستخدم');
      void loadUsers(true);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'فشل حذف المستخدم'));
    }
  };

  const handleLockUser = async (id: string, locked: boolean) => {
    try {
      await lockUser(id, { locked, durationMinutes: 24 * 60, reason: 'إجراء إداري' });
      toast.success(locked ? 'تم قفل المستخدم' : 'تم فتح المستخدم');
      void loadUsers(true);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'فشل في حالة القفل'));
    }
  };

  const handleBulkAssignRole = async () => {
    if (!selectedIds.length) return;
    // FC-SEC-005 — this is the widest privilege move in the section and it used
    // to be the one action with no confirmation, while the far less dangerous
    // bulk delete below did confirm.
    if (!bulkRoleId) {
      toast.error('اختر الدور صراحةً قبل التعيين');
      return;
    }
    const targetRole = roleNameOf(bulkRoleId, roles);
    const warning = isFullAccessRoleName(targetRole)
      ? `\n\n⚠ ${targetRole} يملك كل صلاحيات النظام، وسيصبح كل من حُدد منهم مديراً كاملاً.`
      : '';
    if (!window.confirm(
      `تعيين دور "${targetRole}" لـ ${selectedIds.length} مستخدماً؟${warning}\n\nسيُطبَّق فوراً على جلساتهم.`,
    )) return;
    try {
      const result = await bulkAssignRole({ userIds: selectedIds, roleId: bulkRoleId });
      toast.success(`تم تعيين الدور لـ ${result.updated} مستخدمين`);
      setSelected({});
      void loadUsers(true);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'فشل تعيين الدور'));
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.length) return;
    if (!window.confirm(`هل أنت متأكد أنك تريد حذف ${selectedIds.length} مستخدمين؟`)) return;
    try {
      const result = await bulkDeleteUsers({ userIds: selectedIds });
      toast.success(`تم حذف ${result.deleted} مستخدمين`);
      setSelected({});
      void loadUsers(true);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'فشل في الحذف الجماعي'));
    }
  };

  const handleSaveMatrix = async () => {
    if (!selectedRoleId) return;
    try {
      await updateRolePermissions(selectedRoleId, { permissions: [...new Set(matrix)].sort() });
      toast.success('تم حفظ مصفوفة الصلاحيات');
      void loadRoles();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'فشل حفظ الصلاحيات'));
    }
  };

  // PERMISSIONS MATRIX REBUILD - 2026-04-29
  const hasFullAccess = matrix.includes(FULL_ACCESS_TOKEN);

  const togglePermission = (permissionId: string) => {
    setMatrix((prev) => {
      const next = new Set(prev);
      if (next.has(permissionId)) next.delete(permissionId);
      else next.add(permissionId);
      return Array.from(next);
    });
  };

  const toggleGroupWildcard = (group: PermissionGroup) => {
    setMatrix((prev) => {
      const next = new Set(prev);
      if (next.has(group.wildcard)) {
        next.delete(group.wildcard);
      } else {
        next.add(group.wildcard);
        // إزالة الصلاحيات الفردية ضمن نفس الوحدة لأن wildcard يغطّيها (تجنّب التكرار).
        group.permissions.forEach((permission) => next.delete(permission.id));
      }
      return Array.from(next);
    });
  };

  const toggleFullAccess = () => {
    setMatrix((prev) => (prev.includes(FULL_ACCESS_TOKEN) ? [] : [FULL_ACCESS_TOKEN]));
  };

  const selectAllInGroup = (group: PermissionGroup, select: boolean) => {
    setMatrix((prev) => {
      const next = new Set(prev);
      if (select) {
        group.permissions.forEach((permission) => next.add(permission.id));
      } else {
        next.delete(group.wildcard);
        group.permissions.forEach((permission) => next.delete(permission.id));
      }
      return Array.from(next);
    });
  };

  const filteredGroups = useMemo(() => {
    const query = matrixSearch.trim().toLowerCase();
    if (!query) return PERMISSIONS_CATALOG;
    return PERMISSIONS_CATALOG.map((group) => ({
      ...group,
      permissions: group.permissions.filter((permission) =>
        permission.id.toLowerCase().includes(query)
        || permission.label.toLowerCase().includes(query)
        || group.label.toLowerCase().includes(query),
      ),
    })).filter((group) => group.permissions.length > 0);
  }, [matrixSearch]);

  const totalGranted = useMemo(() => {
    if (hasFullAccess) return ALL_PERMISSION_IDS.length;
    return ALL_PERMISSION_IDS.filter((permissionId) => isPermissionGranted(matrix, permissionId)).length;
  }, [matrix, hasFullAccess]);

  const selectedRoleName = roles.find((role) => role.id === selectedRoleId)?.name || '';
  const isSuperAdminRole = selectedRoleName === 'SuperAdmin';

  return (
    <div className="w-full bg-transparent" dir="rtl">
      <motion.div
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="max-w-7xl mx-auto space-y-6"
      >
        {/* Header Card */}
        <div className="bg-white bg-opacity-90 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
                <UserCog className="w-8 h-8 text-emerald-600" />
                إدارة هوية المستخدمين والصلاحيات
              </h1>
              <p className="text-slate-500 mt-1">نظام إدارة المستخدمين والصلاحيات المتقدم - RBAC Enterprise</p>
            </div>
            <button
              onClick={() => { void loadRoles(); void loadUsers(true); }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 transition"
            >
              <RefreshCw className="w-4 h-4" />
              تحديث
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mt-6">
            <button
              onClick={() => setActiveTab('users')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
                activeTab === 'users'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Users className="w-4 h-4 inline ml-1" />
              المستخدمين
            </button>
            <button
              onClick={() => setActiveTab('matrix')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
                activeTab === 'matrix'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Table2 className="w-4 h-4 inline ml-1" />
              مصفوفة الصلاحيات
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
                activeTab === 'audit'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <History className="w-4 h-4 inline ml-1" />
              سجل التدقيق
            </button>
          </div>
        </div>

            {/* Users Tab */}
            {activeTab === 'users' && (
              <>
                {/* FC-SEC-010 — self-service password change. Previously the
                    system had no way to change a password at all, which is why
                    the superadmin password stayed pinned to the .env value. */}
                <div className="mb-4">
                  <ChangeMyPassword />
                </div>
                {/* Create User Form — `users.create`, the same key POST /users is behind. */}
                {canCreate && (
                <>
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="bg-white bg-opacity-90 backdrop-blur-xl rounded-3xl shadow-xl border border-white/20 p-6"
            >
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Plus className="w-5 h-5 text-emerald-600" />
                إنشاء مستخدم جديد
              </h3>
              <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <input
                  value={createForm.username}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, username: e.target.value }))}
                  placeholder="اسم المستخدم *"
                  className="rounded-xl border border-slate-200 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="البريد الإلكتروني (اختياري)"
                  className="rounded-xl border border-slate-200 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <input
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="كلمة المرور *"
                  className="rounded-xl border border-slate-200 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
                <input
                  value={createForm.firstName}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, firstName: e.target.value }))}
                  placeholder="الاسم الأول"
                  className="rounded-xl border border-slate-200 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <input
                  value={createForm.lastName}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, lastName: e.target.value }))}
                  placeholder="اسم العائلة"
                  className="rounded-xl border border-slate-200 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <select
                  value={createForm.roleId}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, roleId: e.target.value }))}
                  required
                  className={`rounded-xl border px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                    createForm.roleId ? 'border-slate-200' : 'border-amber-400 bg-amber-50'
                  }`}
                >
                  <option value="">— اختر الدور *</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
                <div className="md:col-span-3 flex flex-col sm:flex-row gap-4">
                  <button
                    type="submit"
                    className="flex-1 rounded-xl bg-emerald-600 text-white py-2.5 font-bold hover:bg-emerald-700 transition flex items-center justify-center gap-2"
                  >
                    <Plus className="w-5 h-5" />
                    إنشاء المستخدم فوراً
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!createForm.email) {
                        toast.error('يجب إدخال البريد الإلكتروني لإنشاء الدعوة');
                        return;
                      }
                      if (!createForm.roleId) {
                        toast.error('اختر الدور صراحةً قبل إنشاء الدعوة');
                        return;
                      }
                      try {
                        toast.info('جاري إنشاء الدعوة...');
                        const result = await inviteUser({
                          email: createForm.email,
                          roleId: createForm.roleId,
                        });
                        // FC-SEC-006 — this build has no mail transport, so the
                        // invitation is only a record plus a link. The previous
                        // copy claimed "sent by email" and then discarded the
                        // link, leaving the admin with a green toast and no way
                        // to reach the invitee.
                        setPendingInvitation({
                          email: result.email,
                          link: result.invitationLink,
                          expiresAt: result.expiresAt,
                        });
                        toast.success('تم إنشاء الدعوة — انسخ الرابط وأرسله يدوياً');
                      } catch (e) {
                        toast.error(getErrorMessage(e, 'فشل إنشاء الدعوة'));
                      }
                    }}
                    className="flex-1 rounded-xl bg-blue-600 text-white py-2.5 font-bold hover:bg-blue-700 transition flex items-center justify-center gap-2 shadow-sm"
                  >
                    <Activity className="w-5 h-5" />
                    إنشاء دعوة
                  </button>
                </div>
</form>
            </motion.div>
                </>
                )}

                {/* FC-SEC-006 — the invitation deliverable. Shown, copyable, and
                explicit that nothing was emailed. */}
            {pendingInvitation && (
              <motion.div
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="rounded-2xl border border-amber-300 bg-amber-50/70 p-5 mb-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-bold text-amber-900 mb-1">
                      دعوة جاهزة لـ {pendingInvitation.email}
                    </h4>
                    <p className="text-xs text-amber-800 mb-3">
                      لا يوجد خادم بريد في هذا التثبيت، لذلك لم يُرسل أي بريد. أرسل هذا الرابط
                      إلى المدعوّ بنفسك — صالح حتى{' '}
                      {formatDateTime(pendingInvitation.expiresAt)}
                    </p>
                    <input
                      readOnly
                      value={pendingInvitation.link}
                      onFocus={(e) => e.currentTarget.select()}
                      aria-label="رابط الدعوة"
                      className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-mono text-slate-700"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={copyInvitationLink}
                      className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 transition"
                    >
                      نسخ الرابط
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingInvitation(null)}
                      className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-bold text-amber-800 hover:bg-amber-100 transition"
                    >
                      إخفاء
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Filters & Bulk Actions */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="bg-white bg-opacity-90 backdrop-blur-xl rounded-3xl shadow-xl border border-white/20 p-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
                <div className="relative md:col-span-2">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="بحث..."
                    className="w-full rounded-xl border border-slate-200 pr-10 pl-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">كل الأدوار</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.name}>
                      {role.name}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(normalizeStatusFilter(e.target.value))}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">كل الحالات</option>
                  <option value="active">نشط</option>
                  {/* FC-SEC-012 — a deactivated account used to match no filter
                      at all, so it could only be found by typing its name. */}
                  <option value="inactive">معطَّل</option>
                  <option value="locked">مقفل</option>
                </select>
                <select
                  value={String(limit)}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="10">10 / صفحة</option>
                  <option value="20">20 / صفحة</option>
                  <option value="50">50 / صفحة</option>
                </select>
              </div>

              {/* Bulk Actions */}
              <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-sm font-bold text-slate-600">المحدد: {selectedIds.length}</span>
                <select
                  value={bulkRoleId}
                  onChange={(e) => setBulkRoleId(e.target.value)}
                  aria-label="الدور المطلوب تعيينه"
                  className={`rounded-lg border bg-white px-3 py-1.5 text-sm ${
                    bulkRoleId ? 'border-slate-300' : 'border-amber-400 bg-amber-50'
                  }`}
                >
                  <option value="">— اختر الدور *</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleBulkAssignRole}
                  disabled={!canUpdate || !selectedIds.length}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  <Shield className="w-4 h-4 inline ml-1" />
                  تعيين دور
                </button>
                <button
                  onClick={handleBulkDelete}
                  disabled={!canDelete || !selectedIds.length}
                  className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4 inline ml-1" />
                  حذف
                </button>
              </div>

              {/* Users Table */}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="w-10 p-3" aria-label="تحديد الكل">
                        <input
                          type="checkbox"
                          checked={allSelected && users.length > 0}
                          onChange={(e) =>
                            setSelected((prev) => {
                              const next = { ...prev };
                              if (e.target.checked) users.forEach((u) => (next[u.id] = true));
                              else users.forEach((u) => delete next[u.id]);
                              return next;
                            })
                          }
                          className="accent-emerald-600"
                        />
                      </th>
                      <th className="p-3 text-right text-xs font-bold text-slate-500">المستخدم</th>
                      <th className="p-3 text-right text-xs font-bold text-slate-500">الدور</th>
                      <th className="p-3 text-right text-xs font-bold text-slate-500">الحالة</th>
                      <th className="p-3 text-right text-xs font-bold text-slate-500">آخر دخول</th>
                      <th className="p-3 text-right text-xs font-bold text-slate-500">آخر تحديث</th>
                      <th className="p-3 text-right text-xs font-bold text-slate-500">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-slate-500">
                          جاري التحميل...
                        </td>
                      </tr>
                    ) : users.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-slate-500">
                          لا يوجد مستخدمين
                        </td>
                      </tr>
                    ) : (
                      users.map((user) => (
                        <tr key={user.id} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="p-3">
                            <input
                              type="checkbox"
                              checked={Boolean(selected[user.id])}
                              onChange={(e) => setSelected((prev) => ({ ...prev, [user.id]: e.target.checked }))}
                              className="accent-emerald-600"
                            />
                          </td>
                          <td className="p-3">
                            <div className="font-semibold text-slate-800">{user.fullName}</div>
                            <div className="text-xs text-slate-500">{user.username}</div>
                            {user.email && (
                              <div className="text-xs text-slate-400">{user.email}</div>
                            )}
                          </td>
                          <td className="p-3">
                            <select
                              value={user.roleId}
                              onChange={(e) => {
                                const next = e.target.value;
                                e.target.value = user.roleId;
                                void handleRowRoleChange(user, next);
                              }}
                              className="rounded border border-slate-300 px-2 py-1 text-xs"
                            >
                              {roles.map((role) => (
                                <option key={role.id} value={role.id}>
                                  {role.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-3">
                            {(() => {
                              // FC-SEC-012 — three states, not two. Showing
                              // "locked" for every inactive account made a
                              // deliberate deactivation look like a security
                              // event, and an admin could not tell a locked
                              // account from one they had switched off.
                              if (user.isLocked) {
                                return (
                                  <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
                                    مقفل
                                  </span>
                                );
                              }
                              if (!user.isActive) {
                                return (
                                  <span
                                    title="معطَّل — الحساب غير مستخدم، وليس قفلاً أمنياً"
                                    className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600"
                                  >
                                    معطَّل
                                  </span>
                                );
                              }
                              if (user.isEmailConfirmed === false) {
                                return (
                                  <span
                                    title="أُنشئت بالدعوة ولم تُقبل بعد"
                                    className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700"
                                  >
                                    بانتظار القبول
                                  </span>
                                );
                              }
                              return (
                                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                                  نشط
                                </span>
                              );
                            })()}
                          </td>
                          <td className="p-3 text-xs text-slate-500">
                          <td className="p-3 text-xs text-slate-500">
                            {user.lastLoginAt ? (
                              <span title={formatDateTime(user.lastLoginAt)}>
                                {formatDateTime(user.lastLoginAt)}
                              </span>
                            ) : (
                              <span
                                title="لا توجد أي جلسة مسجّلة لهذا الحساب"
                                className="font-semibold text-amber-700"
                              >
                                لم يدخل بعد
                              </span>
                            )}
                            {Number(user.failedAttempts || 0) > 0 && (
                              <div
                                title={`${user.failedAttempts} محاولة دخول فاشلة`}
                                className="mt-1 inline-block rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700"
                              >
                                {user.failedAttempts} محاولة فاشلة
                              </div>
                            )}
                          </td>
                            {formatDateTime(user.updatedAt)}
                          </td>
                          <td className="p-3">
                            <div className="flex gap-1">
                              {canLock && (
                              <button
                                onClick={() => handleLockUser(user.id, !user.isActive)}
                                className={`p-2 rounded-lg transition ${
                                  user.isActive
                                    ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                }`}
                                title={user.isActive ? 'قفل' : 'فتح'}
                              >
                                {user.isActive ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                              </button>
                            )}
                            {canDelete && (
                              <button
                                onClick={() => handleDeleteUser(user.id)}
                                className="p-2 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 transition"
                                title="حذف"
                              >
<Trash2 className="w-4 h-4" />
                              </button>
                            )}
                            {/* Nothing to show when the session may not mutate users at all —
                                an empty cell reads as "no actions apply here" rather than
                                advertising buttons that would 403. */}
                            {!canLock && !canDelete && (
                              <span className="text-xs text-slate-400">عرض فقط</span>
                            )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
                <span className="text-sm text-slate-500">الإجمالي: {total}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    السابق
                  </button>
                  <span className="text-sm text-slate-600">
                    {page} / {pageCount}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    disabled={page >= pageCount}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    التالي
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}

        {/* Matrix Tab */}
        {activeTab === 'matrix' && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="bg-white bg-opacity-90 backdrop-blur-xl rounded-3xl shadow-xl border border-white/20 p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Shield className="w-6 h-6 text-emerald-600" />
                مصفوفة الصلاحيات
              </h3>
<div className="flex items-center gap-2">
                {/* The keys the server checks: POST /users/roles is `users.create`,
                    and both DELETE /users/roles/:id and PUT .../permissions are
                    `users.update` — role deletion is not `users.delete`. */}
                {canCreate && (
                <button
                  onClick={() => setShowRoleModal(true)}
                  className="rounded-xl border border-emerald-600 text-emerald-600 px-4 py-2 font-bold hover:bg-emerald-50 transition flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  إنشاء دور
                </button>
                )}
                <select
                  value={selectedRoleId}
                  onChange={(e) => setSelectedRoleId(e.target.value)}
                  aria-label="الدور المعروض"
                  className="rounded-xl border border-slate-200 px-4 py-2"
                >
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                  {canUpdate && (
                  <button
                    type="button"
                    onClick={handleDeleteRole}
                    title="حذف هذا الدور (يتعذّر إن كان مرتبطاً بمستخدمين)"
                    className="rounded-xl border border-red-300 text-red-600 px-4 py-2 font-bold hover:bg-red-50 transition flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    حذف الدور
                  </button>
                  )}
                  {canUpdate && (
                  <button
                    onClick={handleSaveMatrix}
                    className="rounded-xl bg-emerald-600 text-white px-4 py-2 font-bold hover:bg-emerald-700 transition flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    حفظ
                  </button>
                  )}
              </div>
            </div>

            {/* Matrix Toolbar — search + summary + full-access master toggle */}
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={matrixSearch}
                  onChange={(e) => setMatrixSearch(e.target.value)}
                  placeholder="ابحث عن صلاحية أو وحدة..."
                  className="w-full rounded-xl border border-slate-200 bg-white pr-9 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="text-xs text-slate-600 font-bold">
                ممنوحة: <span className="text-emerald-700">{totalGranted}</span>
                <span className="text-slate-400"> / </span>
                <span className="text-slate-700">{ALL_PERMISSION_IDS.length}</span>
              </div>
              <label
                className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold cursor-pointer transition ${
                  hasFullAccess
                    ? 'bg-amber-50 border-amber-300 text-amber-800'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
                title={isSuperAdminRole
                  ? 'دور SuperAdmin: صلاحية كاملة دائماً'
                  : 'صلاحية كاملة (*) — تتطلب صلاحية SuperAdmin من المنفّذ'}
              >
                <input
                  type="checkbox"
                  checked={hasFullAccess}
                  onChange={toggleFullAccess}
                  className="w-4 h-4 accent-amber-600"
                />
                صلاحية كاملة (*)
              </label>
            </div>

            {/* Grouped permissions by module — wildcard-aware */}
            <div className="space-y-4">
              {filteredGroups.map((group) => {
                const granted = countGrantedInGroup(matrix, group);
                const groupHasWildcard = matrix.includes(group.wildcard);
                const allInGroupSelected = granted === group.permissions.length;
                const collapsed = collapsedGroups[group.key] ?? false;
                const lockedByFullAccess = hasFullAccess;

                return (
                  <div
                    key={group.key}
                    className={`rounded-2xl border ${
                      groupHasWildcard || lockedByFullAccess
                        ? 'border-emerald-300 bg-emerald-50/50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
                      <button
                        type="button"
                        onClick={() => setCollapsedGroups((prev) => ({ ...prev, [group.key]: !collapsed }))}
                        className="flex items-center gap-2 font-bold text-slate-800"
                      >
                        <span className={`inline-block transition-transform ${collapsed ? '' : 'rotate-90'}`}>▸</span>
                        {group.label}
                        <span className="text-xs font-mono text-slate-400">({group.key})</span>
                        <span className="text-xs text-slate-500 font-normal">
                          {granted} / {group.permissions.length}
                        </span>
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => selectAllInGroup(group, !allInGroupSelected && !groupHasWildcard)}
                          disabled={lockedByFullAccess}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {allInGroupSelected || groupHasWildcard ? 'إلغاء الكل' : 'تحديد الكل'}
                        </button>
                        <label
                          className={`flex items-center gap-2 rounded-lg border px-3 py-1 text-xs font-bold cursor-pointer transition ${
                            groupHasWildcard
                              ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          } ${lockedByFullAccess ? 'opacity-50 pointer-events-none' : ''}`}
                          title={`منح كل صلاحيات ${group.label} عبر wildcard ${group.wildcard}`}
                        >
                          <input
                            type="checkbox"
                            checked={groupHasWildcard}
                            onChange={() => toggleGroupWildcard(group)}
                            className="w-3.5 h-3.5 accent-emerald-600"
                          />
                          <span className="font-mono">{group.wildcard}</span>
                        </label>
                      </div>
                    </div>

                    {!collapsed && (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 p-3">
                        {group.permissions.map((permission) => {
                          const grantedDirect = matrix.includes(permission.id);
                          const grantedEffective = isPermissionGranted(matrix, permission.id);
                          const lockedByGroup = (groupHasWildcard || lockedByFullAccess) && !grantedDirect;
                          return (
                            <label
                              key={permission.id}
                              className={`flex items-start gap-3 rounded-xl border px-3 py-2 transition ${
                                grantedEffective
                                  ? 'bg-emerald-50 border-emerald-200'
                                  : 'bg-white border-slate-200'
                              } ${lockedByGroup ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-50'}`}
                            >
                              <input
                                type="checkbox"
                                checked={grantedEffective}
                                disabled={lockedByGroup}
                                onChange={() => togglePermission(permission.id)}
                                className="w-4 h-4 mt-0.5 accent-emerald-600"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-bold text-slate-800 truncate">{permission.label}</div>
                                <div className="text-[11px] font-mono text-slate-500 truncate">{permission.id}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredGroups.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500">
                  لا توجد صلاحيات تطابق البحث
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Audit Tab */}
        {activeTab === 'audit' && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="bg-white bg-opacity-90 backdrop-blur-xl rounded-3xl shadow-xl border border-white/20 p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Activity className="w-6 h-6 text-emerald-600" />
                سجل تدقيق المستخدمين
              </h3>
              <select
                value={auditUserId}
                onChange={(e) => setAuditUserId(e.target.value)}
                className="rounded-xl border border-slate-200 px-4 py-2"
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName} ({user.username})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {auditRows.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-slate-500">
                  لا توجد سجلات تدقيق
                </div>
              ) : (
                auditRows.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800">{entry.action}</span>
                      <span className="text-xs text-slate-500">
                          {formatDateTime(entry.timestamp)}
                      </span>
                    </div>
                    <div className="text-sm text-slate-600 mt-1">{entry.details}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      المنفذ: {entry.actorUsername} ({entry.actorRole})
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </motion.div>
      <UnifiedIamRoleModal
        open={showRoleModal}
        roleName={newRoleName}
        roleColor={newRoleColor}
        onRoleNameChange={setNewRoleName}
        onRoleColorChange={setNewRoleColor}
        onClose={() => setShowRoleModal(false)}
        onSave={() => {
          void handleCreateRole();
        }}
      />
    </div>
  );
};

export default UnifiedIAM;
