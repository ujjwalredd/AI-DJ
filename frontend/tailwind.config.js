/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Inter"', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        body: ['"Inter"', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['"SF Mono"', '"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        night: '#111827',
        ink: '#111827',
        panel: '#ffffff',
        accent: '#000000',
        mint: '#000000',
        platinum: '#f5f5f7',
      },
      zIndex: {
        stage: '10',
        hud: '20',
        panel: '30',
        modal: '40',
        toast: '50',
      },
      maxWidth: {
        app: '80rem',
      },
    },
  },
  plugins: [],
};
