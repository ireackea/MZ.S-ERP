type ExcelJsModule = typeof import('exceljs');
type ExcelJsInteropModule = ExcelJsModule & {
  default?: ExcelJsModule;
  'module.exports'?: ExcelJsModule;
};

const resolveExcelJsModule = (module: ExcelJsInteropModule): ExcelJsModule => {
  const globalExcelJs = (globalThis as typeof globalThis & { ExcelJS?: ExcelJsModule }).ExcelJS;
  const candidates = [module, module.default, module['module.exports'], globalExcelJs];
  const exceljsModule = candidates.find((candidate): candidate is ExcelJsModule => typeof candidate?.Workbook === 'function');

  if (!exceljsModule) {
    throw new Error('تعذر تحميل مكتبة Excel. يرجى إعادة المحاولة.');
  }

  return exceljsModule;
};

export const createExcelWorkbook = async () => {
  const exceljsModule = resolveExcelJsModule(await import('exceljs') as ExcelJsInteropModule);
  return new exceljsModule.Workbook();
};