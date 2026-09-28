import { useState } from 'react';
import {
  Check,
  FolderDown,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { OrderProfile } from '../../services/itemsService';

/**
 * The named, saved orders.
 *
 * This exists because one saved order is not enough. Somebody who imports a
 * spreadsheet and somebody who then arranges the catalogue by hand are both
 * working, and overwriting the first with the second loses the first — which is
 * the whole reason the save button was built in the first place.
 *
 * Two things it is careful about, both of them the failure this feature invites:
 *
 * - **It says when what is on screen is not what is saved.** Drift is passed in
 *   from the server rather than guessed here, because a stale figure is worse
 *   than none: it would report "saved" about an arrangement that is not saved,
 *   which is the exact defect the whole feature is meant to remove.
 * - **It never says "saved" on its own.** Saving is an explicit act, and the
 *   buttons are labelled with what they do to *now*, not with what they did.
 */
type Props = {
  profiles: OrderProfile[] | null;
  catalogSize: number;
  activeProfileId: string | null;
  busy: boolean;
  canReorder: boolean;
  /**
   * Set when the loaded catalogue is only a prefix of the real one.
   *
   * Worth stating plainly rather than inferring from a count: the list endpoint
   * caps at 1000 rows, and the operator has no other way to learn that items past
   * the cap exist, let alone where they sit in the order they are saving.
   */
  catalogTruncation?: { truncated: boolean; total: number } | null;
  onSaveAs: (name: string) => void;
  onApply: (id: string) => void;
  onRefresh: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

export const ItemOrderProfiles: React.FC<Props> = ({
  profiles,
  catalogSize,
  activeProfileId,
  busy,
  canReorder,
  catalogTruncation,
  onSaveAs,
  onApply,
  onRefresh,
  onRename,
  onDelete,
}) => {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Null means "not loaded yet". Rendering that as an empty list would tell the
  // operator their saved arrangements are gone.
  if (profiles === null) return null;

  const active = profiles.find((profile) => profile.isActive) ?? null;
  const hasDrift = active ? active.drift.moved > 0 || active.drift.unlisted > 0 : false;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FolderDown size={16} className="text-slate-500" />
          <h2 className="text-sm font-black text-slate-800">الترتيبات المحفوظة</h2>
          <span className="text-xs text-slate-500">
            الترتيب الحالي {formatCount(active?.itemCount ?? catalogSize)} من {formatCount(catalogSize)} صنف
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasDrift && active && (
            <span
              className="inline-flex items-center gap-1 rounded-xl border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800"
              title="ما تراه الآن مختلف عن الترتيب المحفوظ. لن يُحفظ شيء حتى تضغط «تحديث» أو «حفظ باسم»."
            >
              <TriangleAlert size={13} />
              {driftLabel(active)}
            </span>
          )}

          {canReorder && !naming && (
            <button
              type="button"
              onClick={() => {
                setNaming(true);
                setName('');
              }}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50"
              title="احفظ الترتيب الذي تراه الآن باسم، ليصبح هو الترتيب المُفعّل"
            >
              <Plus size={13} /> حفظ الترتيب باسم…
            </button>
          )}

          {naming && (
            <span className="inline-flex items-center gap-1">
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && name.trim()) {
                    onSaveAs(name.trim());
                    setNaming(false);
                    setName('');
                  }
                  if (event.key === 'Escape') {
                    setNaming(false);
                    setName('');
                  }
                }}
                placeholder="اسم الترتيب"
                maxLength={120}
                className="rounded-xl border border-slate-300 px-2 py-1.5 text-xs"
              />
              <button
                type="button"
                disabled={!name.trim() || busy}
                onClick={() => {
                  onSaveAs(name.trim());
                  setNaming(false);
                  setName('');
                }}
                className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-black text-white disabled:opacity-50"
              >
                <Save size={13} /> حفظ
              </button>
              <button
                type="button"
                onClick={() => { setNaming(false); setName(''); }}
                className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700"
              >
                إلغاء
              </button>
            </span>
          )}
        </div>
      </div>

      {catalogTruncation?.truncated && (
        <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
          تُحمَّل أول 1000 صنف فقط، والكتالوج كله {formatCount(catalogTruncation.total)} صنف.
          الحفظ يبقى آمنًا — الأصناف غير المعروضة تُضاف في نهاية الترتيب الحالي — لكن
          لا يمكنك تحريك ما لا تراه. ارفع الحد في الخادم أو استخدم التصفية لرؤية
          بقية الكتالوج.
        </p>
      )}

      {profiles.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          لا توجد ترتيبات محفوظة بعد. رتّب الأصناف كما تريد ثم اضغط «حفظ الترتيب باسم…».
        </p>
      ) : (
        <ul className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {profiles.map((profile) => {
            const isActive = profile.id === activeProfileId;
            const drifted = profile.drift.moved > 0 || profile.drift.unlisted > 0;
            return (
              <li
                key={profile.id}
                className={`rounded-2xl border p-3 ${
                  isActive ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {renamingId === profile.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        maxLength={120}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && renameValue.trim()) {
                            onRename(profile.id, renameValue.trim());
                            setRenamingId(null);
                          }
                          if (event.key === 'Escape') setRenamingId(null);
                        }}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold"
                      />
                    ) : (
                      <div className="flex items-center gap-1 truncate text-sm font-black text-slate-900">
                        {profile.name}
                        {isActive && (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-1.5 py-0.5 text-[10px] font-black text-white">
                            <Check size={10} /> مُفعّل
                          </span>
                        )}
                      </div>
                    )}
                    <div className="mt-1 text-[11px] text-slate-500">
                      {formatCount(profile.itemCount)} صنف
                      {profile.drift.unlisted > 0 && ` · ${formatCount(profile.drift.unlisted)} خارج الترتيب`}
                      {profile.drift.moved > 0 && ` · ${formatCount(profile.drift.moved)} مختلف`}
                    </div>
                  </div>
                </div>

                {canReorder && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {!isActive && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onApply(profile.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-700 disabled:opacity-50"
                        title="اجعل هذا الترتيب هو المعروض في كل الأقسام"
                      >
                        <Check size={11} /> تطبيق
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRefresh(profile.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-700 disabled:opacity-50"
                      title="اكتب ما هو معروض الآن في هذا الترتيب المحفوظ، بما فيه الأصناف التي أضفتها"
                    >
                      <RefreshCw size={11} /> تحديث
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setRenamingId(profile.id);
                        setRenameValue(profile.name);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-600 disabled:opacity-50"
                      title="تغيير الاسم"
                    >
                      <Pencil size={11} />
                    </button>
                    {!isActive && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDelete(profile.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-[11px] font-bold text-red-700 disabled:opacity-50"
                        title="حذف هذا الترتيب المحفوظ"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                )}

                {isActive && drifted && (
                  <p className="mt-2 text-[11px] text-amber-800">
                    ما تراه الآن مختلف عن هذا الترتيب. اضغط «تحديث» لحفظه.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

const formatCount = (value: number) => new Intl.NumberFormat('ar-EG').format(Number(value) || 0);

/** The drift, phrased as what to do about it rather than as a number. */
const driftLabel = (profile: OrderProfile): string => {
  const parts: string[] = [];
  if (profile.drift.unlisted > 0) parts.push(`${formatCount(profile.drift.unlisted)} خارج الترتيب`);
  if (profile.drift.moved > 0) parts.push(`${formatCount(profile.drift.moved)} مختلف`);
  return `ما تراه الآن غير محفوظ: ${parts.join('، ')}`;
};
