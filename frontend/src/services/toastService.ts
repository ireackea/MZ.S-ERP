// ENTERPRISE FIX: Copy Feature Fixed - Arabic Display Restored - 2026-03-04
import { toast as sonnerToast } from 'sonner';

type AnyRecord = Record<string, any>;

// ──────────────────────────────────────────────────────────────
// 1. تحويل الرسالة إلى نص عادي (للعرض والنسخ)
// ──────────────────────────────────────────────────────────────
const toMessageText = (message: unknown): string => {
	if (typeof message === 'string') return message;
	if (typeof message === 'number' || typeof message === 'boolean') return String(message);
	if (message == null) return '';
	try {
		return JSON.stringify(message);
	} catch {
		return String(message);
	}
};

// ──────────────────────────────────────────────────────────────
// 2. إصلاح الترميز العربي فقط عند النسخ (Clipboard فقط)
// ──────────────────────────────────────────────────────────────
const normalizeForClipboard = (text: string): string => {
	let safe = text.trim();

	// محاولة إصلاح Mojibake شائعة (UTF-8 تم تفسيره خطأ)
	try {
		const bytes = new Uint8Array(Array.from(safe).map((c) => c.charCodeAt(0) & 0xff));
		const repaired = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
		if (repaired.length > safe.length * 0.7) safe = repaired; // إذا زاد عدد الأحرف العربية
	} catch {}

	return safe.normalize('NFC');
};

const copyText = async (text: string) => {
	const safe = normalizeForClipboard(text);
	if (!safe) return;

	try {
		if (typeof ClipboardItem !== 'undefined') {
			const blob = new Blob([safe], { type: 'text/plain;charset=utf-8' });
			await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
		} else {
			await navigator.clipboard.writeText(safe);
		}
	} catch {
		// فشل صامت (لا يكسر الـ UX)
	}
};

// ──────────────────────────────────────────────────────────────
// 3. حقن زر النسخ بشكل ذكي (دون التأثير على النص المعروض)
// ──────────────────────────────────────────────────────────────
const withCopyAction = (message: unknown, options?: AnyRecord): AnyRecord => {
	const next = { ...(options || {}) };
	const text = toMessageText(message);

	const copyButton = {
		label: '📋 نسخ',
		onClick: () => void copyText(text),
	};

	// إذا كان هناك action أصلي → نضع النسخ في cancel
	if (next.action && !next.cancel) {
		next.cancel = copyButton;
		return next;
	}

	// إذا لم يكن هناك action → نستخدم النسخ كـ action رئيسي
	if (!next.action) {
		next.action = copyButton;
	}

	return next;
};

// ──────────────────────────────────────────────────────────────
// 4. الـ Wrapper النهائي (لا يمس النص المعروض أبداً)
// ──────────────────────────────────────────────────────────────
const baseToast = (message: unknown, options?: AnyRecord) =>
	sonnerToast(message as any, withCopyAction(message, options));

baseToast.success = (message: unknown, options?: AnyRecord) =>
	sonnerToast.success(message as any, withCopyAction(message, options));

baseToast.error = (message: unknown, options?: AnyRecord) =>
	sonnerToast.error(message as any, withCopyAction(message, options));

baseToast.info = (message: unknown, options?: AnyRecord) =>
	sonnerToast.info(message as any, withCopyAction(message, options));

baseToast.warning = (message: unknown, options?: AnyRecord) =>
	sonnerToast.warning(message as any, withCopyAction(message, options));

baseToast.loading = (message: unknown, options?: AnyRecord) =>
	sonnerToast.loading(message as any, withCopyAction(message, options));

baseToast.dismiss = sonnerToast.dismiss;

export const toast = baseToast as typeof sonnerToast;