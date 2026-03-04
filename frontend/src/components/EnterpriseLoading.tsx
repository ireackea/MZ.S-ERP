// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

import React from 'react';
import { Shield, CheckCircle, Loader2 } from 'lucide-react';

// ENTERPRISE FIX: Resilience & Path Bridging - 2026-02-26
// شاشة التحميل الاحترافية - Enterprise Loading Spinner

interface EnterpriseLoadingProps {
  message?: string;
  subMessage?: string;
  showSteps?: boolean;
}

const EnterpriseLoading: React.FC<EnterpriseLoadingProps> = ({
  message = 'جارٍ تحميل النظام...',
  subMessage = 'يرجى الانتظار، يتم إعداد بيئة العمل الآمنة',
  showSteps = true,
}) => {
  const [currentStep, setCurrentStep] = React.useState(0);
  
  const steps = [
    'جاري التحقق من المصادقة...',
    'جاري تحميل بيانات المستخدم...',
    'جاري إعداد الصلاحيات...',
    'جاري تهيئة النظام...',
  ];

  React.useEffect(() => {
    if (!showSteps) return;
    
    const interval = setInterval(() => {
      setCurrentStep((prev) => (prev + 1) % steps.length);
    }, 800);

    return () => clearInterval(interval);
  }, [showSteps, steps.length]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md">
        {/* Main Loading Card */}
        <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 overflow-hidden animate-in fade-in zoom-in duration-500">
          
          {/* Header Section */}
          <div className="bg-gradient-to-r from-slate-900 to-emerald-800 px-8 py-6 text-center">
            <div className="mb-4">
              {/* Animated Logo Placeholder */}
              <div className="relative inline-block">
                <div className="w-20 h-20 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-900/30 animate-pulse">
                  <Shield size={40} className="text-white" />
                </div>
                <div className="absolute -top-1 -right-1 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center animate-bounce">
                  <Loader2 size={14} className="text-white animate-spin" />
                </div>
              </div>
            </div>
            <h1 className="text-xl font-black text-white mb-1">
              نظام إدارة المخازن Enterprise
            </h1>
            <p className="text-emerald-200 text-sm font-medium">
              بوابة الدخول الموحدة
            </p>
          </div>

          {/* Loading Progress Section */}
          <div className="px-8 py-6 space-y-4">
            
            {/* Main Loading Spinner */}
            <div className="flex flex-col items-center justify-center py-6">
              <div className="relative">
                {/* Outer Ring */}
                <div className="w-24 h-24 border-4 border-slate-200 rounded-full"></div>
                {/* Spinning Ring */}
                <div className="absolute top-0 left-0 w-24 h-24 border-4 border-transparent border-t-emerald-600 border-r-emerald-600 rounded-full animate-spin"></div>
                {/* Inner Icon */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                  <Shield size={32} className="text-emerald-600" />
                </div>
              </div>
              
              {/* Loading Message */}
              <p className="mt-6 text-lg font-bold text-slate-700 text-center">
                {message}
              </p>
              <p className="mt-2 text-sm text-slate-500 text-center">
                {subMessage}
              </p>
            </div>

            {/* Progress Steps */}
            {showSteps && (
              <div className="space-y-2 py-4">
                {steps.map((step, index) => (
                  <div
                    key={index}
                    className={`flex items-center gap-3 transition-all duration-300 ${
                      index === currentStep
                        ? 'opacity-100 scale-105'
                        : index < currentStep
                        ? 'opacity-50'
                        : 'opacity-30'
                    }`}
                  >
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                        index < currentStep
                          ? 'bg-emerald-500'
                          : index === currentStep
                          ? 'bg-emerald-600 animate-pulse'
                          : 'bg-slate-300'
                      }`}
                    >
                      {index < currentStep ? (
                        <CheckCircle size={14} className="text-white" />
                      ) : index === currentStep ? (
                        <Loader2 size={14} className="text-white animate-spin" />
                      ) : null}
                    </div>
                    <span
                      className={`text-sm font-medium transition-all ${
                        index === currentStep
                          ? 'text-emerald-700 font-bold'
                          : 'text-slate-500'
                      }`}
                    >
                      {step}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Progress Bar */}
            <div className="pt-4">
              <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all duration-500 ease-out"
                  style={{
                    width: `${((currentStep + 1) / steps.length) * 100}%`,
                  }}
                />
              </div>
              <p className="text-xs text-slate-500 text-center mt-2">
                {Math.round(((currentStep + 1) / steps.length) * 100)}% مكتمل
              </p>
            </div>

            {/* Security Badge */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mt-4">
              <div className="flex items-center justify-center gap-2">
                <Shield size={16} className="text-emerald-600" />
                <span className="text-xs font-bold text-emerald-700">
                  محمي بواسطة FeedFactory IAM Security
                </span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="bg-slate-50 border-t border-slate-200 px-8 py-4 text-center">
            <p className="text-xs text-slate-500">
              © 2026 FeedFactory Pro Enterprise
            </p>
            <p className="text-xs text-slate-400 mt-1">
              إصدار النظام: v2.0.0
            </p>
          </div>
        </div>

        {/* Additional Info */}
        <p className="text-center text-emerald-100 text-xs mt-4 font-medium">
          جارٍ إعداد بيئة العمل الآمنة...
        </p>
      </div>
    </div>
  );
};

export default EnterpriseLoading;
