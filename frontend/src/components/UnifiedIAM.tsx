// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

// ENTERPRISE FIX: Phase 2 - Multi-User Sync - Final Completion Pass - 2026-03-02
// UTF-8 Encoding Fixed - Arabic Text Restored
import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  fetchUserAudit,
  createCustomRole,
  inviteUser,
  type UserDto,
  type RoleDto,
  type UserAuditDto,
} from '@services/usersService';

const UnifiedIAM: React.FC = () => {
  const [users, setUsers] = useState<UserDto[]>([]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'locked' | ''>('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkRoleId, setBulkRoleId] = useState('');

  const [activeTab, setActiveTab] = useState<'users' | 'matrix' | 'audit'>('users');
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [matrix, setMatrix] = useState<string[]>([]);

  // ENTERPRISE FIX: Custom Roles - Phase 2 - 2026-03-02
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleColor, setNewRoleColor] = useState('#64748b');

  const [auditUserId, setAuditUserId] = useState('');
  const [auditRows, setAuditRows] = useState<UserAuditDto[]>([]);

  const [createForm, setCreateForm] = useState({
    username: '',
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    roleId: '',
  });

  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);
  const pageCount = Math.max(1, Math.ceil(total / limit));

  const loadRoles = async () => {
    try {
      const data = await fetchRoles();
      setRoles(data);
      if (!bulkRoleId && data[0]) setBulkRoleId(data[0].id);
      if (!selectedRoleId && data[0]) setSelectedRoleId(data[0].id);
      if (!createForm.roleId && data[0]) setCreateForm((prev) => ({ ...prev, roleId: data[0].id }));
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'فشل تحميل الأدوار');
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
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'فشل تحميل المستخدمين');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void Promise.all([loadRoles(), loadUsers(false)]);
  }, []);

  useEffect(() => {
    void loadUsers(false);
  }, [search, roleFilter, statusFilter, limit]);

  useEffect(() => {
    const role = roles.find((entry) => entry.id === selectedRoleId) || roles[0];
    if (!role) return;
    setSelectedRoleId(role.id);
    setMatrix(role.permissionsList || []);
  }, [selectedRoleId, roles]);

  useEffect(() => {
    if (!auditUserId) return;
    void fetchUserAudit(auditUserId)
      .then(setAuditRows)
      .catch((error: any) => toast.error(error?.response?.data?.message || 'فشل تحميل سجل التدقيق'));
  }, [auditUserId]);

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
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
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'فشل إنشاء الدور');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.username || !createForm.password) {
      toast.error('يرجى إدخال اسم المستخدم وكلمة المرور على الأقل');
      return;
    }
    try {
      await createUser({
        username: createForm.username,
        email: createForm.email || undefined,
        password: createForm.password,
        firstName: createForm.firstName || undefined,
        lastName: createForm.lastName || undefined,
        roleId: createForm.roleId || undefined,
      });
      toast.success('تم إنشاء المستخدم بنجاح');
      setCreateForm({ username: '', email: '', password: '', firstName: '', lastName: '', roleId: roles[0]?.id || '' });
      void loadUsers(true);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'فشل إنشاء المستخدم');
    }
  };

  const handleUpdateUser = async (id: string, payload: any) => {
    try {
      await updateUser(id, payload);
      toast.success('تم تحديث المستخدم');
      void loadUsers(true);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'فشل تحديث المستخدم');
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!window.confirm('هل أنت متأكد أنك تريد حذف هذا المستخدم؟')) return;
    try {
      await deleteUser(id);
      toast.success('تم حذف المستخدم');
      void loadUsers(true);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'فشل حذف المستخدم');
    }
  };

  const handleLockUser = async (id: string, locked: boolean) => {
    try {
      await lockUser(id, { locked, durationMinutes: 24 * 60, reason: 'إجراء إداري' });
      toast.success(locked ? 'تم قفل المستخدم' : 'تم فتح المستخدم');
      void loadUsers(true);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'فشل في حالة القفل');
    }
  };

  const handleBulkAssignRole = async () => {
    if (!selectedIds.length) return;
    try {
      const result = await bulkAssignRole({ userIds: selectedIds, roleId: bulkRoleId });
      toast.success(`تم تعيين الدور لـ ${result.updated} مستخدمين`);
      setSelected({});
      void loadUsers(true);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'فشل تعيين الدور');
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
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'فشل في الحذف الجماعي');
    }
  };

  const handleSaveMatrix = async () => {
    if (!selectedRoleId) return;
    try {
      await updateRolePermissions(selectedRoleId, { permissions: [...new Set(matrix)].sort() });
      toast.success('تم حفظ مصفوفة الصلاحيات');
      void loadRoles();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'فشل حفظ الصلاحيات');
    }
  };

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
            {/* Create User Form */}
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
                  className="rounded-xl border border-slate-200 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
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
                        toast.error('يجب إدخال البريد الإلكتروني لإرسال الدعوة');
                        return;
                      }
                      try {
                        toast.info('جاري إرسال رسالة الدعوة...');
                        const result = await inviteUser({
                          email: createForm.email,
                          roleId: createForm.roleId || undefined,
                        });
                        toast.success('تم إرسال الدعوة بنجاح إلى ' + result.email);
                      } catch (e) {
                        toast.error('فشل إرسال الدعوة');
                      }
                    }}
                    className="flex-1 rounded-xl bg-blue-600 text-white py-2.5 font-bold hover:bg-blue-700 transition flex items-center justify-center gap-2 shadow-sm"
                  >
                    <Activity className="w-5 h-5" />
                    إرسال دعوة عبر البريد
                  </button>
                </div>
              </form>
            </motion.div>

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
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">كل الحالات</option>
                  <option value="active">نشط</option>
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
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                >
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleBulkAssignRole}
                  disabled={!selectedIds.length}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  <Shield className="w-4 h-4 inline ml-1" />
                  تعيين دور
                </button>
                <button
                  onClick={handleBulkDelete}
                  disabled={!selectedIds.length}
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
                      <th className="p-3 text-right text-xs font-bold text-slate-500">تحديد</th>
                      <th className="p-3 text-right text-xs font-bold text-slate-500">المستخدم</th>
                      <th className="p-3 text-right text-xs font-bold text-slate-500">الدور</th>
                      <th className="p-3 text-right text-xs font-bold text-slate-500">الحالة</th>
                      <th className="p-3 text-right text-xs font-bold text-slate-500">آخر تحديث</th>
                      <th className="p-3 text-right text-xs font-bold text-slate-500">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-500">
                          جاري التحميل...
                        </td>
                      </tr>
                    ) : users.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-500">
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
                          </td>
                          <td className="p-3">
                            <select
                              value={user.roleId}
                              onChange={(e) => handleUpdateUser(user.id, { roleId: e.target.value })}
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
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-bold ${
                                user.isActive
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-red-50 text-red-700'
                              }`}
                            >
                              {user.isActive ? 'نشط' : 'مقفل'}
                            </span>
                          </td>
                          <td className="p-3 text-xs text-slate-500">
                            {new Date(user.updatedAt).toLocaleString('ar-EG')}
                          </td>
                          <td className="p-3">
                            <div className="flex gap-1">
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
                              <button
                                onClick={() => handleDeleteUser(user.id)}
                                className="p-2 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 transition"
                                title="حذف"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
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
                <button
                  onClick={() => setShowRoleModal(true)}
                  className="rounded-xl border border-emerald-600 text-emerald-600 px-4 py-2 font-bold hover:bg-emerald-50 transition flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  إنشاء دور
                </button>
                <select
                  value={selectedRoleId}
                  onChange={(e) => setSelectedRoleId(e.target.value)}
                  className="rounded-xl border border-slate-200 px-4 py-2"
                >
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleSaveMatrix}
                  className="rounded-xl bg-emerald-600 text-white px-4 py-2 font-bold hover:bg-emerald-700 transition flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  حفظ
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {['users.view', 'users.create', 'users.update', 'users.delete', 'users.lock', 'users.audit',
                'inventory.view', 'inventory.create', 'inventory.update', 'inventory.delete',
                'sales.view', 'sales.create', 'sales.update', 'sales.delete',
                'reports.view', 'reports.export',
                'settings.view', 'settings.update'
              ].map((perm) => {
                const checked = matrix.includes(perm);
                return (
                  <label
                    key={perm}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition ${
                      checked
                        ? 'bg-emerald-50 border-emerald-200'
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setMatrix((prev) => (checked ? prev.filter((p) => p !== perm) : [...prev, perm]))}
                      className="w-4 h-4 accent-emerald-600"
                    />
                    <span className="text-sm font-mono text-slate-700">{perm}</span>
                  </label>
                );
              })}
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
                        {new Date(entry.timestamp).toLocaleString('ar-EG')}
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

      {/* ENTERPRISE FIX: Custom Roles Modal - 2026-03-02 */}
      {showRoleModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Shield className="w-5 h-5 text-emerald-600" />
                إنشاء دور صلاحيات جديد
              </h3>
              <button onClick={() => setShowRoleModal(false)} className="text-slate-400 hover:text-slate-600">
                <Unlock className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">اسم الدور</label>
                <input
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder="مثال: مشرف مبيعات"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">لون الشارة</label>
                <div className="flex gap-2">
                  {['#64748b', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef'].map(color => (
                    <button
                      key={color}
                      onClick={() => setNewRoleColor(color)}
                      className={`w-8 h-8 rounded-full border-2 ${newRoleColor === color ? 'border-slate-800 scale-110 shadow-md' : 'border-transparent'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
              <button
                onClick={() => setShowRoleModal(false)}
                className="px-6 py-2 rounded-xl text-slate-600 font-bold hover:bg-slate-200 transition"
              >
                إلغاء
              </button>
              <button
                onClick={handleCreateRole}
                className="px-6 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 shadow-md flex items-center gap-2"
              >
                <Save className="w-4 h-4" /> حفظ الدور
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UnifiedIAM;
