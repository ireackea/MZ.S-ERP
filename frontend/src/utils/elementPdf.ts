type ElementPdfPaperSize = 'a3' | 'a4' | 'legal' | 'letter';
type ElementPdfOrientation = 'portrait' | 'landscape';
type ElementPdfMargins = number | [number, number, number, number];

type BuildElementPdfOptions = {
  element: HTMLElement;
  fileName: string;
  paperSize?: ElementPdfPaperSize | Uppercase<ElementPdfPaperSize>;
  orientation?: ElementPdfOrientation;
  marginMm?: ElementPdfMargins;
  scale?: number;
  backgroundColor?: string;
};

type BuiltElementPdfDocument = {
  pageCount: number;
  save: () => void;
  toBlob: () => Blob;
  toDataUri: () => string;
};

type Html2CanvasModule = typeof import('html2canvas');
type JsPdfModule = typeof import('jspdf');

let pdfDependencyLoader: Promise<{ html2canvas: Html2CanvasModule['default']; jsPDF: JsPdfModule['jsPDF'] }> | null = null;

const loadPdfDependencies = async () => {
  if (!pdfDependencyLoader) {
    pdfDependencyLoader = Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]).then(([html2canvasModule, jsPdfModule]) => ({
      html2canvas: html2canvasModule.default,
      jsPDF: jsPdfModule.jsPDF,
    }));
  }

  return pdfDependencyLoader;
};

const normalizePaperSize = (
  paperSize: BuildElementPdfOptions['paperSize'],
): ElementPdfPaperSize => {
  const normalized = String(paperSize || 'a4').trim().toLowerCase();
  if (normalized === 'a3' || normalized === 'legal' || normalized === 'letter') {
    return normalized;
  }
  return 'a4';
};

const normalizeMargins = (marginMm: ElementPdfMargins | undefined): [number, number, number, number] => {
  if (Array.isArray(marginMm)) {
    const [top = 0, right = 0, bottom = 0, left = 0] = marginMm;
    return [top, right, bottom, left].map((value) => Math.max(0, Number(value) || 0)) as [number, number, number, number];
  }

  const uniformMargin = Math.max(0, Number(marginMm ?? 8) || 0);
  return [uniformMargin, uniformMargin, uniformMargin, uniformMargin];
};

const waitForFonts = async () => {
  if (typeof document === 'undefined' || !('fonts' in document) || !document.fonts?.ready) {
    return;
  }

  try {
    await document.fonts.ready;
  } catch {
    return;
  }
};

const waitForNextPaint = async () => {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
};

const blobToDataUrl = async (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error || new Error('تعذر تحويل الصورة إلى data URL.'));
  reader.onload = () => {
    if (typeof reader.result === 'string') {
      resolve(reader.result);
      return;
    }

    reject(new Error('تعذر قراءة الصورة كـ data URL.'));
  };
  reader.readAsDataURL(blob);
});

const buildInlineImageMap = async (element: HTMLElement) => {
  const imageUrls = Array.from(element.querySelectorAll('img'))
    .map((image) => image.currentSrc || image.getAttribute('src') || '')
    .filter((src) => src && !src.startsWith('data:') && !src.startsWith('blob:'));

  const uniqueUrls = Array.from(new Set(imageUrls));
  const resolvedEntries = await Promise.all(uniqueUrls.map(async (url) => {
    try {
      const response = await fetch(url, {
        mode: 'cors',
        credentials: 'omit',
        cache: 'force-cache',
      });

      if (!response.ok) {
        return null;
      }

      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);
      return [url, dataUrl] as const;
    } catch {
      return null;
    }
  }));

  return new Map(resolvedEntries.filter((entry): entry is readonly [string, string] => Boolean(entry)));
};

export const buildElementPdfDocument = async ({
  element,
  fileName,
  paperSize = 'a4',
  orientation = 'portrait',
  marginMm,
  scale = 2,
  backgroundColor = '#ffffff',
}: BuildElementPdfOptions): Promise<BuiltElementPdfDocument> => {
  if (!element) {
    throw new Error('تعذر العثور على عنصر صالح لإنشاء ملف PDF.');
  }

  await waitForFonts();
  await waitForNextPaint();

  const { html2canvas, jsPDF } = await loadPdfDependencies();
  const inlineImageMap = await buildInlineImageMap(element);
  const normalizedMargins = normalizeMargins(marginMm);
  const normalizedPaperSize = normalizePaperSize(paperSize);
  const targetScale = Math.max(1, Math.min(3, Number(scale) || 2));
  const elementRect = element.getBoundingClientRect();
  const captureWidth = Math.max(1, Math.ceil(Math.max(element.scrollWidth, element.clientWidth, elementRect.width)));
  const captureHeight = Math.max(1, Math.ceil(Math.max(element.scrollHeight, element.clientHeight, elementRect.height)));
  const captureMarker = `element-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  element.setAttribute('data-element-pdf-marker', captureMarker);

  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(element, {
      scale: targetScale,
      useCORS: true,
      backgroundColor,
      logging: false,
      imageTimeout: 5000,
      width: captureWidth,
      height: captureHeight,
      windowWidth: captureWidth,
      windowHeight: captureHeight,
      scrollX: 0,
      scrollY: -window.scrollY,
      onclone: (clonedDocument) => {
        const clonedElement = clonedDocument.querySelector(`[data-element-pdf-marker="${captureMarker}"]`);
        if (!(clonedElement instanceof HTMLElement)) {
          return;
        }

        for (const image of Array.from(clonedElement.querySelectorAll('img'))) {
          const originalSrc = image.currentSrc || image.getAttribute('src') || '';
          const inlineSrc = inlineImageMap.get(originalSrc);
          if (inlineSrc) {
            image.setAttribute('src', inlineSrc);
          }
        }
      },
    });
  } finally {
    element.removeAttribute('data-element-pdf-marker');
  }

  const pdf = new jsPDF({
    unit: 'mm',
    format: normalizedPaperSize,
    orientation,
    compress: true,
    putOnlyUsedFonts: true,
  });

  const pageWidthMm = pdf.internal.pageSize.getWidth();
  const pageHeightMm = pdf.internal.pageSize.getHeight();
  const [marginTopMm, marginRightMm, marginBottomMm, marginLeftMm] = normalizedMargins;
  const contentWidthMm = Math.max(1, pageWidthMm - marginLeftMm - marginRightMm);
  const contentHeightMm = Math.max(1, pageHeightMm - marginTopMm - marginBottomMm);
  const pageHeightPx = Math.max(1, Math.floor((contentHeightMm * canvas.width) / contentWidthMm));

  let renderedHeightPx = 0;
  let pageCount = 0;

  while (renderedHeightPx < canvas.height) {
    const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedHeightPx);
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceHeightPx;

    const context = pageCanvas.getContext('2d');
    if (!context) {
      throw new Error('تعذر إنشاء سياق الرسم لإعداد ملف PDF.');
    }

    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    context.drawImage(
      canvas,
      0,
      renderedHeightPx,
      canvas.width,
      sliceHeightPx,
      0,
      0,
      canvas.width,
      sliceHeightPx,
    );

    if (pageCount > 0) {
      pdf.addPage();
    }

    const renderedHeightMm = (sliceHeightPx * contentWidthMm) / canvas.width;
    const imageDataUrl = pageCanvas.toDataURL('image/jpeg', 0.98);
    pdf.addImage(imageDataUrl, 'JPEG', marginLeftMm, marginTopMm, contentWidthMm, renderedHeightMm, undefined, 'FAST');

    renderedHeightPx += sliceHeightPx;
    pageCount += 1;
  }

  const normalizedFileName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;

  return {
    pageCount,
    save: () => {
      pdf.save(normalizedFileName);
    },
    toBlob: () => pdf.output('blob'),
    toDataUri: () => pdf.output('datauristring'),
  };
};

export const saveElementPdfDocument = async (options: BuildElementPdfOptions) => {
  const document = await buildElementPdfDocument(options);
  document.save();
  return document;
};
