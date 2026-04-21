declare module '@welldone-software/why-did-you-render' {
  import type * as ReactNamespace from 'react';

  type WhyDidYouRenderOptions = {
    trackAllPureComponents?: boolean;
    collapseGroups?: boolean;
    logOnDifferentValues?: boolean;
    include?: RegExp[];
  };

  const whyDidYouRender: (
    react: typeof ReactNamespace,
    options?: WhyDidYouRenderOptions,
  ) => void;

  export default whyDidYouRender;
}