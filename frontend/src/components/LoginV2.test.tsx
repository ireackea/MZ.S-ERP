// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
// ENTERPRISE FIX: Arabic Encoding Repair for Login Tests - 2026-02-28

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LoginV2 from './LoginV2';
import { login } from '@services/authService';

const mockNavigate = vi.fn();

vi.mock('@services/authService', () => ({
  login: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const renderLogin = (props: Partial<React.ComponentProps<typeof LoginV2>> = {}) =>
  render(
    <MemoryRouter>
      <LoginV2 {...props} />
    </MemoryRouter>,
  );

describe('LoginV2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('يعرض النصوص العربية الأساسية في الواجهة', () => {
    renderLogin();

    expect(screen.getByText('نظام إدارة المخازن Enterprise')).toBeInTheDocument();
    expect(screen.getByText('اسم المستخدم أو البريد الإلكتروني')).toBeInTheDocument();
    expect(screen.getByText('كلمة المرور')).toBeInTheDocument();
    expect(screen.getByText('تذكرني')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تسجيل الدخول' })).toBeInTheDocument();
  });

  it('يبدّل إظهار وإخفاء كلمة المرور', async () => {
    const user = userEvent.setup();
    renderLogin();

    const toggleButton = screen.getByRole('button', { name: 'إظهار كلمة المرور' });
    const passwordInput = screen.getByPlaceholderText('********') as HTMLInputElement;

    expect(passwordInput.type).toBe('password');

    await user.click(toggleButton);
    expect(passwordInput.type).toBe('text');
    expect(screen.getByRole('button', { name: 'إخفاء كلمة المرور' })).toBeInTheDocument();
  });

  it('ينفذ تسجيل الدخول ويوجه المستخدم حسب الدور', async () => {
    const user = userEvent.setup();
    vi.mocked(login).mockResolvedValue({
      accessToken: 'token-123',
      tokenType: 'Bearer',
      expiresIn: '24h',
      user: {
        id: 'u-1',
        username: 'manager.user',
        role: 'manager',
        permissions: [],
      },
    });

    renderLogin();

    await user.type(screen.getByPlaceholderText('example@company.com'), 'manager.user');
    await user.type(screen.getByPlaceholderText('********'), 'password123');
    await user.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('manager.user', 'password123');
      expect(mockNavigate).toHaveBeenCalledWith('/operations', { replace: true });
    });
  });

  it('يتعامل مع فشل المصادقة دون كسر واجهة تسجيل الدخول', async () => {
    const user = userEvent.setup();
    const loginError = new Error('Request failed with status code 401');
    (loginError as any).response = {
      status: 401,
      data: { message: 'اسم المستخدم أو كلمة المرور غير صحيحة.' },
    };
    vi.mocked(login).mockRejectedValue(loginError);

    renderLogin();

    await user.type(screen.getByPlaceholderText('example@company.com'), 'bad.user');
    await user.type(screen.getByPlaceholderText('********'), 'bad-pass');
    await user.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('bad.user', 'bad-pass');
    });
    expect(screen.getByRole('button', { name: 'تسجيل الدخول' })).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('ينفذ onAuthenticated عند تمريره من الأب', async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();

    vi.mocked(login).mockResolvedValue({
      accessToken: 'token-999',
      tokenType: 'Bearer',
      expiresIn: '24h',
      user: {
        id: 'u-99',
        username: 'admin',
        role: 'admin',
        permissions: ['*'],
      },
    });

    renderLogin({ onAuthenticated });

    await user.type(screen.getByPlaceholderText('example@company.com'), 'admin');
    await user.type(screen.getByPlaceholderText('********'), 'Admin@1234');
    await user.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));

    await waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'u-99', username: 'admin', role: 'admin' }),
        '/',
      );
    });
  });

  it('يظهر حالة التحميل أثناء انتظار الاستجابة', async () => {
    const user = userEvent.setup();
    vi.mocked(login).mockImplementation(() => new Promise(() => undefined));

    renderLogin();

    await user.type(screen.getByPlaceholderText('example@company.com'), 'loading.user');
    await user.type(screen.getByPlaceholderText('********'), 'loading-pass');
    await user.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));

    expect(await screen.findByText('جارٍ تسجيل الدخول...')).toBeInTheDocument();
  });
});
