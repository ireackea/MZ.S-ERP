import React from 'react';

export const enableWhyDidYouRender = async () => {
  const explicitlyEnabled = String(import.meta.env.VITE_ENABLE_WHY_DID_YOU_RENDER || '').trim() === 'true';
  if (!import.meta.env.DEV || !explicitlyEnabled) return;

  try {
    const moduleName = '@welldone-software/why-did-you-render';
    const { default: whyDidYouRender } = await import(/* @vite-ignore */ moduleName);
    whyDidYouRender(React, {
      trackAllPureComponents: false,
      collapseGroups: true,
      logOnDifferentValues: true,
      include: [/^App/, /^Layout$/, /^ProtectedRoute$/],
    });
  } catch (error) {
    console.warn('[debug] why-did-you-render was not initialized:', error);
  }
};