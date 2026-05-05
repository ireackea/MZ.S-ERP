// ENTERPRISE FIX: Copy Feature Fixed - Arabic Display Restored - 2026-03-04
import { toast as sonnerToast } from 'sonner';

type AnyRecord = Record<string, any>;

// ──────────────────────────────────────────────────────────────
// 1. تحويل الرسالة إلى نص عادي (للعرض والنسخ)
// ──────────────────────────────────────────────────────────────
const isRecord = (value: unknown): value is AnyRecord =>
	typeof value === 'object' && value !== null;

const toMessageText = (message: unknown): string => {
	if (typeof message === 'string') return message;
	if (typeof message === 'number' || typeof message === 'boolean') return String(message);
	if (message == null) return '';
	if (message instanceof Error) return message.message;
	if (Array.isArray(message)) return message.map(toMessageText).filter(Boolean).join('\n');
	if (isRecord(message)) {
		if (isRecord(message.props) && 'children' in message.props) {
			return toMessageText(message.props.children);
		}

		for (const key of ['message', 'title', 'description', 'detail']) {
			const value = message[key];
			if (typeof value === 'string' && value.trim()) return value;
		}
	}
	try {
		return JSON.stringify(message, null, 2);
	} catch {
		return String(message);
	}
};

// ──────────────────────────────────────────────────────────────
// 2. تجهيز النص للنسخ دون إفساد النص العربي السليم
// ──────────────────────────────────────────────────────────────
const hasArabicText = (text: string): boolean => /[\u0600-\u06FF]/.test(text);
const hasMojibakeSignals = (text: string): boolean => /[ØÙÚÛÃÂ�]/.test(text);

const normalizeForClipboard = (text: string): string => {
	const safe = text.replace(/\r\n/g, '\n').trim().normalize('NFC');
	if (!safe || hasArabicText(safe) || !hasMojibakeSignals(safe)) return safe;

	// محاولة محدودة لإصلاح Mojibake فقط عندما يكون النص بلا أحرف عربية أصلًا.
	try {
		const bytes = new Uint8Array(Array.from(safe).map((c) => c.charCodeAt(0) & 0xff));
		const repaired = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim().normalize('NFC');
		if (hasArabicText(repaired) && !repaired.includes('�')) return repaired;
	} catch {}

	return safe;
};

const copyUsingTextarea = (text: string): boolean => {
	if (typeof document === 'undefined') return false;

	const textarea = document.createElement('textarea');
	textarea.value = text;
	textarea.setAttribute('readonly', 'true');
	textarea.style.position = 'fixed';
	textarea.style.inset = '0';
	textarea.style.opacity = '0';
	document.body.appendChild(textarea);
	textarea.focus();
	textarea.select();

	try {
		return document.execCommand('copy');
	} catch {
		return false;
	} finally {
		document.body.removeChild(textarea);
	}
};

const copyText = async (text: string): Promise<boolean> => {
	const safe = normalizeForClipboard(text);
	if (!safe) return false;

	try {
		if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(safe);
			return true;
		}
	} catch {
		// fallback below
	}

	return copyUsingTextarea(safe);
};

// ──────────────────────────────────────────────────────────────
// 3. حقن زر النسخ بشكل ذكي (دون التأثير على النص المعروض)
// ──────────────────────────────────────────────────────────────
const withCopyAction = (message: unknown, options?: AnyRecord): AnyRecord => {
	const next = { ...(options || {}) };
	const text = toMessageText(message);

	const copyButton = {
		label: 'نسخ النص',
		onClick: () => {
			void copyText(text).then((copied) => {
				if (copied) sonnerToast.success('تم نسخ نص الإشعار بوضوح.');
			});
		},
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