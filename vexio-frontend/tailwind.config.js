/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: '#3B82F6',
        'primary-hover': '#2563EB',
        secondary: '#60A5FA',
        'bg-main': '#F8FAFC',
        'bg-card': '#FFFFFF',
        'border-main': '#E2E8F0',
        'text-main': '#0F172A',
        'text-muted': '#64748B',
        success: '#10B981',
        danger: '#EF4444',
        warning: '#F59E0B',
      },
    },
  },
  plugins: [],
};
