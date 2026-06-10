import React from 'react';
import styles from './URLPreviewCard.module.css';

export interface URLPreviewCardProps {
  url: string;
  title?: string | undefined;
  description?: string | undefined;
}

/** Extract a human-readable domain from a URL string. */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Derive a title from the URL path when no explicit title is provided. */
function deriveTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname
      .replace(/\/$/, '')
      .split('/')
      .filter(Boolean)
      .pop();
    if (!path) return extractDomain(url);
    // Decode percent-encoded segments and replace common separators
    const decoded = decodeURIComponent(path)
      .replace(/[-_]/g, ' ')
      .replace(/\.\w+$/, '');
    return decoded.length > 60 ? decoded.slice(0, 57) + '...' : decoded;
  } catch {
    return url;
  }
}

/** Build a favicon URL using Google's favicon service. */
function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

export const URLPreviewCard: React.FC<URLPreviewCardProps> = ({
  url,
  title,
  description,
}) => {
  const domain = extractDomain(url);
  const displayTitle = title?.trim() || deriveTitleFromUrl(url);
  const displayDescription = description?.trim() || url;

  return (
    <a
      className={styles.card}
      href={url}
      rel="noopener noreferrer"
      target="_blank"
    >
      <div className={styles.thumbnail} aria-hidden="true">
        <img
          alt=""
          className={styles.favicon}
          loading="lazy"
          src={faviconUrl(domain)}
        />
      </div>
      <div className={styles.body}>
        <span className={styles.domain}>{domain}</span>
        <span className={styles.title}>{displayTitle}</span>
        {displayDescription && (
          <span className={styles.description}>{displayDescription}</span>
        )}
      </div>
    </a>
  );
};
