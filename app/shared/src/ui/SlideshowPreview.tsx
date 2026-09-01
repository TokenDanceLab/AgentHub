/* ═══════════════════════════════════════════════════════════════════════
   SlideshowPreview — Browser-side .pptx file renderer using JSZip

   Props:
     fileUrl   — URL to fetch the .pptx file from
     fileName  — Display name shown in the header
     fileBlob  — Optional pre-fetched Blob (skips fetch)
     onClose   — Called when the close button is clicked

   A PPTX file is a ZIP of XML files. This component extracts slide
   content from the XML, renders each slide as a styled card, and
   provides arrow navigation plus a thumbnail strip.

   Exported state:
     currentSlide, totalSlides, nextSlide(), prevSlide()
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react';
import { Button } from './Button';
import styles from './SlideshowPreview.module.css';
import { Tooltip } from './Tooltip';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';

export interface SlideshowPreviewProps {
  fileUrl: string;
  fileName: string;
  fileBlob?: Blob | undefined;
  onClose?: (() => void) | undefined;
}

interface SlideData {
  index: number;
  /** Raw slide text content extracted from XML */
  text: string[];
  /** Embedded images as base64 data URIs */
  images: string[];
}

function extractTextFromXml(xmlString: string): string[] {
  const texts: string[] = [];
  /* Match all <a:t>...</a:t> elements (the text content in PPTX XML) */
  const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xmlString)) !== null) {
    const text = match[1];
    if (text && text.trim()) texts.push(text.trim());
  }
  return texts;
}

// ═══════════════════════════════════════════════════════════════════════
// Lazy JSZip loader — dynamic import keeps ~96 KB out of main bundle.
// Only loaded when a slideshow file (.pptx/.odp) is actually opened.
//
// JSZip 3.x uses `export = JSZip` (CJS), so dynamic import() yields
// { default: typeof JSZip }. We unwrap .default and cast to get access
// to the static `loadAsync` helper (present at runtime but missing from
// the DT type declarations for the constructor side).
// ═══════════════════════════════════════════════════════════════════════

interface JSZipStatic {
  loadAsync(data: ArrayBuffer, options?: Record<string, unknown>): Promise<JSZipInstance>;
}

interface JSZipInstance {
  file(path: string): { async(type: 'string'): Promise<string>; async(type: 'blob'): Promise<Blob> } | null;
  forEach(callback: (relativePath: string, file: { dir: boolean; name: string }) => void): void;
}

let jszipModule: JSZipStatic | null = null;

async function getJSZip(): Promise<JSZipStatic> {
  if (!jszipModule) {
    const mod = await import('jszip') as { default: JSZipStatic };
    jszipModule = mod.default;
  }
  return jszipModule;
}

async function parsePptx(arrayBuffer: ArrayBuffer): Promise<SlideData[]> {
  const JSZip = await getJSZip();
  const zip = await JSZip.loadAsync(arrayBuffer);

  /* Find slide files: ppt/slides/slide1.xml, slide2.xml, etc. */
  const slideFiles: { index: number; path: string }[] = [];
  zip.forEach((relativePath: string, file: { dir: boolean }) => {
    const slideMatch = relativePath.match(/^ppt\/slides\/slide(\d+)\.xml$/);
    if (slideMatch?.[1] && !file.dir) {
      slideFiles.push({
        index: parseInt(slideMatch[1], 10),
        path: relativePath,
      });
    }
  });

  /* Sort by slide number */
  slideFiles.sort((a, b) => a.index - b.index);

  const slides: SlideData[] = [];

  for (const slideFile of slideFiles) {
    const xmlContent = await zip.file(slideFile.path)?.async('string');
    const text = xmlContent ? extractTextFromXml(xmlContent) : [];

    /* Extract embedded images from relationships */
    const images: string[] = [];
    const relsPath = `ppt/slides/_rels/slide${slideFile.index}.xml.rels`;
    const relsFile = zip.file(relsPath);
    if (relsFile) {
      const relsXml = await relsFile.async('string');
      const imgRefs = relsXml.match(/Target="[^"]*\.(png|jpg|jpeg|gif|svg|bmp)"/gi) ?? [];
      for (const ref of imgRefs) {
        const target = ref.match(/Target="([^"]*)"/)?.[1];
        if (target) {
          /* Resolve relative path */
          const imagePath = target.startsWith('..')
            ? `ppt/${target.replace('../', '')}`
            : target.startsWith('/')
              ? target.slice(1)
              : `ppt/slides/${target}`;
          const imageFile = zip.file(imagePath);
          if (imageFile) {
            const blob = await imageFile.async('blob');
            const dataUrl = await blobToDataUrl(blob);
            images.push(dataUrl);
          }
        }
      }
    }

    slides.push({ index: slideFile.index, text, images });
  }

  return slides;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

export const SlideshowPreview: React.FC<SlideshowPreviewProps> = ({
  fileUrl,
  fileName,
  fileBlob,
  onClose,
}) => {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const slideContainerRef = useRef<HTMLDivElement>(null);

  const totalSlides = slides.length;

  const loadPptx = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSlides([]);
    setCurrentSlide(0);

    try {
      let arrayBuffer: ArrayBuffer;

      if (fileBlob) {
        arrayBuffer = await fileBlob.arrayBuffer();
      } else {
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
        }
        arrayBuffer = await response.arrayBuffer();
      }

      const parsedSlides = await parsePptx(arrayBuffer);
      if (parsedSlides.length === 0) {
        throw new Error('No slides found in presentation');
      }
      setSlides(parsedSlides);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error parsing presentation';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [fileUrl, fileBlob]);

  useEffect(() => {
    void loadPptx();
  }, [loadPptx]);

  const nextSlide = useCallback(() => {
    setCurrentSlide((prev) => Math.min(prev + 1, totalSlides - 1));
  }, [totalSlides]);

  const prevSlide = useCallback(() => {
    setCurrentSlide((prev) => Math.max(prev - 1, 0));
  }, []);

  /* Keyboard navigation */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        nextSlide();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        prevSlide();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextSlide, prevSlide]);

  /* Scroll active thumbnail into view */
  useEffect(() => {
    if (!slideContainerRef.current) return;
    const activeThumb = slideContainerRef.current.querySelector(`[data-slide-index="${currentSlide}"]`);
    activeThumb?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [currentSlide]);

  const currentSlideData = slides[currentSlide];

  return (
    <section className={styles.root} aria-label={`${fileName} slideshow preview`}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div className={styles.title}>
          <span className={styles.fileName} title={fileName}>{fileName}</span>
          <span className={styles.badge}>PPTX</span>
        </div>
        <span className={styles.counter}>
          {totalSlides > 0 ? `${currentSlide + 1} / ${totalSlides}` : '—'}
        </span>
        {onClose && (
          <Tooltip label={t("aria.closePreview")}>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={onClose}
              aria-label={t("aria.closePreview")}
            >
              <X size={16} />
            </Button>
          </Tooltip>
        )}
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>{t('preview.parsingSlideshow')}</span>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className={styles.error}>
          <AlertCircle size={28} className={styles.errorIcon} />
          <span className={styles.errorMessage}>{error}</span>
          <button className={styles.retryBtn} onClick={loadPptx} type="button">
            <RotateCcw size={14} />
            <span>{t('preview.retry')}</span>
          </button>
        </div>
      )}

      {/* ── Slide view ── */}
      {!loading && !error && currentSlideData && (
        <div className={styles.slideArea}>
          <Tooltip label={t("aria.previousImage")}>
            <button
              className={styles.navBtn}
              onClick={prevSlide}
              disabled={currentSlide === 0}
              type="button"
              aria-label={t("aria.previousImage")}
            >
              <ChevronLeft size={20} />
            </button>
          </Tooltip>

          <div className={styles.slideCanvas}>
            <div className={styles.slideContent}>
              {currentSlideData.images.map((img, i) => (
                <img key={i} src={img} alt={`Slide ${currentSlide + 1} image ${i + 1}`} className={styles.slideImage} />
              ))}
              {currentSlideData.text.length > 0 && (
                <div className={styles.slideTextContainer}>
                  {currentSlideData.text.map((text, i) => (
                    <p key={i} className={styles.slideText}>{text}</p>
                  ))}
                </div>
              )}
              {currentSlideData.text.length === 0 && currentSlideData.images.length === 0 && (
                <div className={styles.slideEmpty}>{t('preview.blankSlide')}</div>
              )}
            </div>
          </div>

          <Tooltip label={t("aria.nextImage")}>
            <button type="button"
              className={styles.navBtn}
              onClick={nextSlide}
              disabled={currentSlide >= totalSlides - 1}
              aria-label={t("aria.nextImage")}
            >
              <ChevronRight size={20} />
            </button>
          </Tooltip>
        </div>
      )}

      {/* ── Thumbnail strip ── */}
      {!loading && !error && slides.length > 1 && (
        <div className={styles.thumbnailStrip} ref={slideContainerRef}>
          {slides.map((slide, i) => (
            <button
              key={i}
              data-slide-index={i}
              type="button"
              className={`${styles.thumbnail} ${i === currentSlide ? styles.thumbnailActive : ''}`}
              onClick={() => setCurrentSlide(i)}
              aria-label={`幻灯片 ${i + 1}`}
              aria-current={i === currentSlide ? 'true' : undefined}
            >
              <span className={styles.thumbnailNumber}>{i + 1}</span>
              <span className={styles.thumbnailLabel}>
                {slide.text[0]?.slice(0, 20) ?? `Slide ${i + 1}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};
