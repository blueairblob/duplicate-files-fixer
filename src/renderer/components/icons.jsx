import React from 'react';

// Minimal stroke-icon set (Lucide-style geometry) so the UI has consistent,
// theme-tinted icons instead of emoji. Each accepts size + color and inherits
// currentColor by default.
function Icon({ size = 16, color = 'currentColor', children, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }} {...rest}>
      {children}
    </svg>
  );
}

export const FolderIcon = (p) => (
  <Icon {...p}><path d="M4 5h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/></Icon>
);
export const ShieldIcon = (p) => (
  <Icon {...p}><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3Z"/></Icon>
);
export const TargetIcon = (p) => (
  <Icon {...p}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.5" fill="currentColor"/></Icon>
);
export const XIcon = (p) => (
  <Icon {...p}><path d="M6 6l12 12M18 6L6 18"/></Icon>
);
export const ChevronDownIcon = (p) => (
  <Icon {...p}><path d="M6 9l6 6 6-6"/></Icon>
);
export const ChevronRightIcon = (p) => (
  <Icon {...p}><path d="M9 6l6 6-6 6"/></Icon>
);
export const ChevronLeftIcon = (p) => (
  <Icon {...p}><path d="M15 6l-6 6 6 6"/></Icon>
);
export const SlidersIcon = (p) => (
  <Icon {...p}><path d="M4 8h10M18 8h2M4 16h4M12 16h8"/><circle cx="16" cy="8" r="2"/><circle cx="10" cy="16" r="2"/></Icon>
);
export const LockIcon = (p) => (
  <Icon {...p}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></Icon>
);
export const HistoryIcon = (p) => (
  <Icon {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/></Icon>
);
export const ArchiveIcon = (p) => (
  <Icon {...p}><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/></Icon>
);
export const BanIcon = (p) => (
  <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M5.5 5.5l13 13"/></Icon>
);
export const SidebarIcon = (p) => (
  <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9.5 4v16"/></Icon>
);
export const CopyIcon = (p) => (
  <Icon {...p}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></Icon>
);
export const PlusIcon = (p) => (
  <Icon {...p}><path d="M12 5v14M5 12h14"/></Icon>
);
export const SearchIcon = (p) => (
  <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></Icon>
);
export const CheckCircleIcon = (p) => (
  <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></Icon>
);
export const ArrowRightIcon = (p) => (
  <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6"/></Icon>
);
export const SettingsIcon = (p) => (
  <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></Icon>
);

export const ImageIcon = (p) => (
  <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 15l-4.5-4.5L9 18"/></Icon>
);
export const FilmIcon = (p) => (
  <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/></Icon>
);
export const MusicIcon = (p) => (
  <Icon {...p}><circle cx="7" cy="17" r="2.5"/><circle cx="17" cy="15" r="2.5"/><path d="M9.5 17V6l10-2v11"/></Icon>
);
export const FileIcon = (p) => (
  <Icon {...p}><path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/></Icon>
);
