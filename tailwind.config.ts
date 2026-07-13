import type { Config } from 'tailwindcss';

/**
 * Ticker design tokens - "Neo-brutalist paper terminal".
 * Source of truth: design/README.md "Design Tokens (quick reference)".
 * Where references/slock-theme.json disagrees with the README, the README wins.
 *
 * The palette, radius, and shadow scales are REPLACED (not extended) so the
 * only easy options are the correct ones: 0px radius everywhere and a single
 * hard, un-blurred shadow. There is deliberately no blurred shadow and no
 * non-zero radius (besides the settings-toggle `pill`) to reach for by accident.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    // Closed palette - each accent has exactly one job.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      black: '#000000',
      white: '#FFFFFF',
      ink: '#0F1419', // near-black text (X ink)
      page: '#FFFFFF', // app/page background (clean white, X-style)
      card: '#FFFFFF', // post cards, panels, tiles
      line: '#EFF3F4', // soft dividers between feed items (X-style hairline)
      wash: '#F7F9F9', // hover / subtle fill
      band: '#F7F9F9', // quoted insets / section fills (soft grey now, not cream)
      'surface-alt': '#FFF4CC', // explainer strips, onboarding row tint
      yellow: '#FFD700', // chrome only + "needs checking" tier
      pink: '#FF6B9D', // follow / active states
      cyan: {
        DEFAULT: '#5BC0EB', // subscribe / sign-up / primary conversion CTAs
        hover: '#4AAFDA',
      },
      salmon: '#F4845F', // reply / thread connective tissue
      lavender: '#C4B5FD', // @-mention and account-reference chips
      muted: '#536471', // metadata, secondary text (X grey-blue)
      'muted-alt': '#687684', // placeholder / tertiary
      'on-dark': '#A0A0A0', // secondary text on black surfaces
      'on-dark-alt': '#E0E0E0',
      'check-green': '#2DC653', // pricing feature checks
      tier: {
        solid: '#7FE08A',
        needs: '#FFD700',
        disputed: '#FF7A7A',
        // "open question" uses an ink glyph cell + white label cell (no fill token).
      },
    },
    // 0 radius is the default. `pill` is the single exception (settings toggle track).
    borderRadius: {
      none: '0',
      DEFAULT: '0',
      pill: '9999px',
    },
    // One shadow: hard, offset, never blurred. No size variants exist.
    boxShadow: {
      none: 'none',
      DEFAULT: '2px 2px 0 0 #000000',
      hard: '2px 2px 0 0 #000000',
      'hard-yellow': '2px 2px 0 0 #FFD700',
      'hard-pink': '2px 2px 0 0 #FF6B9D',
    },
    extend: {
      fontFamily: {
        // Wired to next/font CSS variables (see src/lib/fonts.ts).
        sans: ['var(--font-grotesk)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      // Loading skeletons pulse opacity - no shimmer sweep.
      keyframes: {
        tkpulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        tkpulse: 'tkpulse 1.4s ease-in-out infinite',
      },
      // Default border is 2px solid ink; `border-4` (4px) stays available for
      // reply left borders and blockquote/inset accents.
      borderWidth: {
        DEFAULT: '2px',
      },
      borderColor: {
        DEFAULT: '#000000',
      },
    },
  },
  plugins: [],
};

export default config;
