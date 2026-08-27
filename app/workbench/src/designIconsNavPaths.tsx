import React from 'react';
import type { DesignNavIconName } from './designIconsHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   designIconsNavPaths — pure path builders for DesignNavIcon glyphs (#754).
   Returns path nodes only (no outer svg element); shell stays in designIcons.tsx.
   ═══════════════════════════════════════════════════════════════════════ */

export function navIconPaths(name: DesignNavIconName): React.ReactNode {
  switch (name) {
    case 'chat':
      return <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />;
    case 'railContacts':
      return (
        <>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </>
      );
    case 'railDocs':
      return (
        <>
          <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v5h5" />
          <path d="M9 13h6M9 17h4" />
        </>
      );
    case 'railAgent':
      return (
        <>
          <rect x="4.5" y="9" width="15" height="11.5" rx="3" />
          <path d="M12 5.5v3.5" />
          <circle cx="12" cy="4.25" r="1.75" />
          <path d="M3.25 13.5v3.5M20.75 13.5v3.5" />
          <path d="M8.5 14.25h.1M15.5 14.25h.1" />
          <path d="M9.5 17.75h5" />
        </>
      );
    case 'railProjects':
      return (
        <>
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </>
      );
    case 'railDevices':
      return (
        <>
          <rect x="3" y="4.5" width="18" height="12" rx="2" />
          <path d="M2 20h20" />
        </>
      );
    case 'railUsage':
      return (
        <>
          <path d="M5 20v-6" />
          <path d="M12 20V6" />
          <path d="M19 20v-10" />
          <path d="M3 20h18" />
        </>
      );
    case 'railSettings':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </>
      );
    case 'users':
      return (
        <>
          <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
          <circle cx="9.5" cy="7" r="3.5" />
          <path d="M20.5 21v-2.2a3.4 3.4 0 0 0-2.4-3.2" />
          <path d="M16.4 3.5a3.4 3.4 0 0 1 0 6.6" />
        </>
      );
    case 'user':
      return (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M5 21v-1a7 7 0 0 1 14 0v1" />
        </>
      );
    case 'external':
      return (
        <>
          <path d="M8 18a6 6 0 0 1 8-8" />
          <path d="M10 14a6 6 0 0 1 8-8" />
          <path d="M14 19h5v-5" />
          <path d="m19 19-6-6" />
        </>
      );
    case 'userPlus':
      return (
        <>
          <circle cx="9" cy="7" r="3.5" />
          <path d="M3 21v-1.5A4.5 4.5 0 0 1 7.5 15h3" />
          <path d="M17 11v8" />
          <path d="M13 15h8" />
        </>
      );
    case 'groups':
      return (
        <>
          <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5Z" />
          <path d="M8 9h8" />
          <path d="M8 13h5" />
        </>
      );
    case 'service':
      return (
        <>
          <path d="M4 13a8 8 0 0 1 16 0" />
          <path d="M5 13h3v5H6a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2Z" />
          <path d="M16 13h3a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-2v-5Z" />
          <path d="M17 18c0 2-1.8 3-5 3" />
        </>
      );
    case 'help':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.8 2.8 0 0 1 5.1 1.6c0 1.9-2.6 2.2-2.6 4" />
          <path d="M12 18h.01" />
        </>
      );
    case 'home':
      return (
        <>
          <path d="m4 11 8-7 8 7" />
          <path d="M6 10v10h12V10" />
          <path d="M10 20v-5h4v5" />
        </>
      );
    case 'drive':
      return (
        <>
          <path d="M4 17h16" />
          <path d="m7 17 3-10h4l3 10" />
          <path d="M7 17l-2 4h14l-2-4" />
        </>
      );
    case 'library':
      return (
        <>
          <path d="M5 4h5v17H5z" />
          <path d="M10 4h5v17h-5z" />
          <path d="m17 5 3 16" />
        </>
      );
    case 'notes':
      return (
        <>
          <path d="M6 4h12v16H6z" />
          <path d="M9 8h6" />
          <path d="M9 12h6" />
          <path d="M9 16h4" />
        </>
      );
    case 'overview':
      return (
        <>
          <path d="M5 7h14" />
          <path d="M5 12h14" />
          <path d="M5 17h9" />
        </>
      );
    case 'browser':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3c2.4 2.6 3.6 5.6 3.6 9S14.4 18.4 12 21" />
          <path d="M12 3C9.6 5.6 8.4 8.6 8.4 12S9.6 18.4 12 21" />
        </>
      );
    case 'download':
      return (
        <>
          <path d="M12 4v10" />
          <path d="m8 10 4 4 4-4" />
          <path d="M5 20h14" />
        </>
      );
    case 'package':
      return (
        <>
          <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" />
          <path d="M4 7.5 12 12l8-4.5" />
          <path d="M12 12v9" />
        </>
      );
    case 'store':
      return (
        <>
          <path d="M4 10h16l-1.5-6h-13Z" />
          <path d="M6 10v10h12V10" />
          <path d="M9 20v-5h6v5" />
        </>
      );
    case 'policy':
      return (
        <>
          <path d="M12 3v5l3-3" />
          <path d="M12 8 9 5" />
          <path d="M5 12a7 7 0 0 1 13-3" />
          <path d="M12 21v-5l-3 3" />
          <path d="m12 16 3 3" />
          <path d="M19 12a7 7 0 0 1-13 3" />
        </>
      );
    case 'model':
      return (
        <>
          <rect x="5" y="5" width="14" height="14" rx="2" />
          <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
          <path d="M9 9h6v6H9z" />
        </>
      );
    case 'audit':
      return (
        <>
          <path d="M6 4h12v18H6z" />
          <path d="M9 8h6" />
          <path d="M9 12h6" />
          <path d="M9 16h3" />
          <path d="m15 17 1.5 1.5 3-3" />
        </>
      );
    case 'folder':
      return <path d="M4 6h7l2 2h7v12H4z" />;
    case 'grid':
      return (
        <>
          <path d="M5 5h6v6H5z" />
          <path d="M13 5h6v6h-6z" />
          <path d="M5 13h6v6H5z" />
          <path d="M13 13h6v6h-6z" />
        </>
      );
    case 'running':
      return (
        <>
          <path d="M5 12h6" />
          <path d="m12 5 7 7-7 7" />
        </>
      );
    case 'done':
      return <path d="M20 6 9 17l-5-5" />;
    case 'archive':
      return (
        <>
          <path d="M4 7h16" />
          <path d="M6 7v14h12V7" />
          <path d="M9 11h6" />
          <path d="M5 3h14v4H5z" />
        </>
      );
    case 'bell':
      return (
        <>
          <path d="M6 9a6 6 0 0 1 12 0c0 7 2 7 2 9H4c0-2 2-2 2-9" />
          <path d="M10 21h4" />
        </>
      );
    case 'palette':
      return (
        <>
          <path d="M12 4a8 8 0 0 0 0 16h1.5a1.8 1.8 0 0 0 .6-3.5 1.8 1.8 0 0 1 .6-3.5H16a4 4 0 0 0 0-8Z" />
          <circle cx="8.5" cy="10" r=".8" />
          <circle cx="11" cy="8" r=".8" />
          <circle cx="7.5" cy="13.5" r=".8" />
        </>
      );
    case 'agent':
      return (
        <>
          <rect x="4" y="9" width="16" height="11" rx="2" />
          <path d="M12 5v4" />
          <circle cx="12" cy="4" r="2" />
          <path d="M8 14h.1M16 14h.1" />
        </>
      );
    case 'tasks':
      return (
        <>
          <path d="M4 6h11" />
          <path d="M4 12h9" />
          <path d="M4 18h7" />
          <path d="m16 17 2 2 4-5" />
        </>
      );
    case 'settings':
      return (
        <>
          <path d="M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8Z" />
          <path d="M4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6l1.4 1.4m0-11.4l-1.4 1.4m-8.6 8.6l-1.4 1.4" />
        </>
      );
    case 'search':
      return (
        <>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </>
      );
    case 'sidebarLeft':
      return (
        <>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M9 4v16" />
        </>
      );
    case 'sidebarRight':
      return (
        <>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M15 4v16" />
        </>
      );
    case 'sun':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </>
      );
    case 'laptop':
      return (
        <>
          <path d="M5 5h14v10H5z" />
          <path d="M3 19h18l-2-4H5Z" />
        </>
      );
    case 'states':
      return (
        <>
          <path d="M5 7h14" />
          <path d="M5 12h14" />
          <path d="M5 17h14" />
          <circle cx="7" cy="7" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="17" cy="17" r="2" />
        </>
      );
    case 'inbox':
      return (
        <>
          <path d="M4 13h4l2 3h4l2-3h4" />
          <path d="M5 13 7.5 5h9L19 13v6H5Z" />
        </>
      );
    case 'lock':
      return (
        <>
          <rect x="5" y="10" width="14" height="10" rx="2" />
          <path d="M8 10V8a4 4 0 0 1 8 0v2" />
          <path d="M12 14v2" />
        </>
      );
    case 'error404':
      return (
        <>
          <path d="M14 3H6v18h12V7Z" />
          <path d="M14 3v4h4" />
          <path d="M9.5 12.5h.01" />
          <path d="M14.5 12.5h.01" />
          <path d="M10 17c1.2-1 2.8-1 4 0" />
        </>
      );
    case 'copy':
      return (
        <>
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
        </>
      );
    case 'logout':
      return (
        <>
          <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
          <path d="M14 8l4 4-4 4" />
          <path d="M18 12H9" />
        </>
      );
    case 'qrcode':
      return (
        <>
          <path d="M4 4h6v6H4z" />
          <path d="M14 4h6v6h-6z" />
          <path d="M4 14h6v6H4z" />
          <path d="M14 14h2v2h-2z" />
          <path d="M18 14h2v4h-4v2h-2v-4h4z" />
        </>
      );
    case 'check':
      return <path d="M20 6 9 17l-5-5" />;
    case 'checkCircle':
      return (
        <>
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" fill="currentColor" stroke="none" />
          <path
            d="m10.8 15.8-4-4 1.4-1.4 2.6 2.6 5.9-5.9 1.4 1.4-7.3 7.3Z"
            fill="var(--td-surface)"
            stroke="none"
          />
        </>
      );
    case 'plus':
      return (
        <>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </>
      );
    case 'pin':
      return (
        <>
          <path d="M12 19V5" />
          <path d="m6 11 6-6 6 6" />
        </>
      );
    case 'paperclip':
      return (
        <>
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </>
      );
    case 'upload':
      return (
        <>
          <path d="M12 20V6" />
          <path d="m7 11 5-5 5 5" />
          <path d="M5 20h14" />
        </>
      );
    case 'template':
      return (
        <>
          <path d="M5 5h6v6H5z" />
          <path d="M13 5h6v6h-6z" />
          <path d="M5 13h14v6H5z" />
        </>
      );
    case 'fileText':
      return (
        <>
          <path d="M14 3H6v18h12V7Z" />
          <path d="M14 3v4h4" />
          <path d="M9 12h6" />
          <path d="M9 16h4" />
        </>
      );
    case 'filter':
      return (
        <>
          <path d="M4 6h16" />
          <path d="M7 12h10" />
          <path d="M10 18h4" />
        </>
      );
    case 'back':
      return (
        <>
          <path d="M15 18 9 12l6-6" />
          <path d="M20 12H9" />
        </>
      );
    case 'forward':
      return (
        <>
          <path d="m9 18 6-6-6-6" />
          <path d="M4 12h11" />
        </>
      );
    case 'refresh':
      return (
        <>
          <path d="M20 11a8 8 0 0 0-14.5-4.6L4 8" />
          <path d="M4 4v4h4" />
          <path d="M4 13a8 8 0 0 0 14.5 4.6L20 16" />
          <path d="M20 20v-4h-4" />
        </>
      );
    case 'more':
      return (
        <>
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </>
      );
    case 'tools':
      return (
        <>
          <path d="m14.7 6.3 3 3" />
          <path d="M4 20l7.5-7.5" />
          <path d="M13 5a4 4 0 0 0 5 5l-8 8H6v-4Z" />
        </>
      );
    case 'star':
      return <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.9-5.4 2.9 1-6-4.4-4.3 6.1-.9Z" />;
    case 'link':
      return (
        <>
          <path d="M14 3h7v7" />
          <path d="M10 14 21 3" />
          <path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
        </>
      );
    case 'send':
      return (
        <>
          <line x1="12" y1="19" x2="12" y2="5" />
          <polyline points="5 12 12 5 19 12" />
        </>
      );
    case 'stop':
      return <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />;
    case 'edit':
      return (
        <>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </>
      );
    case 'chevron':
      return <polyline points="6 9 12 15 18 9" />;
    case 'split':
      return (
        <>
          <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
          <path d="M12 4.5v15" />
        </>
      );
    case 'close':
      return (
        <>
          <path d="M6 6l12 12" />
          <path d="M18 6 6 18" />
        </>
      );
    case 'preview':
      return (
        <>
          <path d="M9 18H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" />
          <path d="M9 8h5" />
          <path d="M9 12h3" />
          <path d="M14 15h6" />
          <path d="m17 12 3 3-3 3" />
        </>
      );
    default:
      return <path d="M4 6h7l2 2h7v12H4z" />;
  }
}
