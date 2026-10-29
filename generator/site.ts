/**
 * The hand-maintained part of `docs.json`. The generator merges the generated
 * navigation and redirects into this object and writes the result to
 * `docs.json` at the repository root.
 */
import type { NavLanguage, NavRef, Redirect } from './lib/nav.ts';

export interface NavbarLink {
  label?: string;
  href: string;
  icon?: string;
  type?: 'github' | 'discord';
}

export interface FooterLinkColumn {
  header?: string;
  items: Array<{ label: string; href: string }>;
}

export interface DocsJson {
  $schema: string;
  theme: 'mint' | 'maple' | 'palm' | 'willow' | 'linden' | 'almond' | 'aspen' | 'sequoia' | 'luma';
  name: string;
  description?: string;
  colors: { primary: string; light?: string; dark?: string };
  logo?: { light: string; dark: string; href?: string };
  favicon?: string | { light: string; dark: string };
  icons?: { library: 'fontawesome' | 'lucide' | 'tabler' };
  appearance?: { default?: 'system' | 'light' | 'dark'; strict?: boolean };
  background?: { decoration?: 'gradient' | 'grid' | 'windows' };
  styling?: { eyebrows?: 'section' | 'breadcrumbs' };
  fonts?: { heading?: { family: string; weight?: number }; body?: { family: string; weight?: number } };
  navbar?: { links?: NavbarLink[]; primary?: { type: 'button' | 'github'; label?: string; href: string } };
  footer?: { socials?: Record<string, string>; links?: FooterLinkColumn[] };
  search?: { prompt?: string };
  seo?: { indexing?: 'navigable' | 'all'; metatags?: Record<string, string> };
  interaction?: { drilldown?: boolean };
  contextual?: { options: Array<'copy' | 'view' | 'chatgpt' | 'claude' | 'perplexity'> };
  errors?: { 404?: { redirect?: boolean } };
  redirects?: Redirect[];
  navigation: { languages: Array<NavLanguage | NavRef> };
}

export const REPOSITORY_URL = 'https://github.com/brandonmcconnell/bible';

/** Everything except `navigation` and `redirects`, which the generator fills in. */
export const docsBase: Omit<DocsJson, 'navigation' | 'redirects'> = {
  $schema: 'https://mintlify.com/docs.json',
  theme: 'mint',
  name: 'The Bible',
  description:
    'Read the Bible in many translations and languages. Every book, chapter and verse, with footnotes, cross references, people, places and events.',
  colors: {
    primary: '#8B1E2D',
    light: '#E8A0A8',
    dark: '#6E1622',
  },
  logo: {
    light: '/logo/light.svg',
    dark: '/logo/dark.svg',
  },
  favicon: '/favicon.svg',
  icons: { library: 'lucide' },
  appearance: { default: 'system' },
  styling: { eyebrows: 'breadcrumbs' },
  fonts: {
    heading: { family: 'Source Serif 4', weight: 600 },
  },
  navbar: {
    links: [{ label: 'Free Use Bible API', href: 'https://bible.helloao.org/' }],
    primary: { type: 'github', href: REPOSITORY_URL },
  },
  footer: {
    socials: { github: REPOSITORY_URL },
    links: [
      {
        header: 'Sources',
        items: [
          { label: 'Free Use Bible API', href: 'https://bible.helloao.org/' },
          { label: 'eBible.org', href: 'https://ebible.org/' },
          { label: 'OpenBible.info cross references', href: 'https://www.openbible.info/labs/cross-references/' },
          { label: 'Theographic Bible Metadata', href: 'https://github.com/robertrouse/theographic-bible-metadata' },
        ],
      },
      {
        header: 'Project',
        items: [
          { label: 'GitHub', href: REPOSITORY_URL },
          { label: 'Built with Mintlify', href: 'https://mintlify.com' },
        ],
      },
    ],
  },
  search: { prompt: 'Search the Bible…' },
  seo: { indexing: 'navigable' },
  interaction: { drilldown: false },
  contextual: { options: ['copy', 'view'] },
  errors: { 404: { redirect: false } },
};
