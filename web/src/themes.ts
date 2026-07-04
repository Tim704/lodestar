// Theme registry — CONTRACT §8 (v3). Metadata only: the token values live
// solely in styles.css as [data-theme] blocks; previews re-scope them by
// setting the data-theme attribute on any element.

export type ThemeId =
  | 'almanac'
  | 'graphite'
  | 'observatory'
  | 'ephemeris'
  | 'riso'
  | 'broadsheet';

export type NavLayout = 'sidebar' | 'topbar';
export type Density = 'comfortable' | 'compact';

export interface ThemeDef {
  id: ThemeId;
  label: string;
  vibe: string;
  nav: NavLayout;
  density: Density;
  dark: boolean;
}

export const THEMES: ThemeDef[] = [
  {
    id: 'almanac',
    label: 'Night Almanac',
    vibe: 'warm field-journal · ink borders · serif',
    nav: 'sidebar',
    density: 'comfortable',
    dark: false,
  },
  {
    id: 'graphite',
    label: 'Graphite',
    vibe: 'quiet modern · hairlines · one calm blue',
    nav: 'topbar',
    density: 'comfortable',
    dark: false,
  },
  {
    id: 'observatory',
    label: 'Observatory',
    vibe: 'calm dark · starlight on slate',
    nav: 'sidebar',
    density: 'comfortable',
    dark: true,
  },
  {
    id: 'ephemeris',
    label: 'Ephemeris',
    vibe: 'monospace terminal · phosphor green',
    nav: 'topbar',
    density: 'compact',
    dark: true,
  },
  {
    id: 'riso',
    label: 'Riso',
    vibe: 'soft & rounded · coral warmth',
    nav: 'sidebar',
    density: 'comfortable',
    dark: false,
  },
  {
    id: 'broadsheet',
    label: 'Broadsheet',
    vibe: 'high-contrast print · bold & loud',
    nav: 'topbar',
    density: 'compact',
    dark: false,
  },
];

export const DEFAULT_THEME: ThemeId = 'almanac';

/** Resolve a stored value to a theme, migrating legacy 'dark'/'light'. */
export function resolveTheme(stored: string | null | undefined): ThemeDef {
  const id =
    stored === 'dark' ? 'observatory' : stored === 'light' ? 'almanac' : stored;
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!;
}
