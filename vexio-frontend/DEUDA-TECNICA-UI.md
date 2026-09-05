# Deuda técnica de UI detectada (NO arreglada — anotado a pedido)

Notas tomadas durante el fix quirúrgico de contraste + iconografía + branding del login
(demos comerciales). Nada de esto se tocó; queda como referencia para un refactor futuro.

## 1. Hex hardcodeado en vez de tokens de Tailwind
`tailwind.config.js` define `primary`, `bg-card`, `text-muted`, `border-main`, etc., pero
casi ningún componente los usa: se escriben los literales `#3B82F6`, `#2563EB`, `#1E3A5F`,
`#EFF6FF`, `#F0F4F8`, `#E8EEF4`, `#F1F5F9`, `#0F172A`, `#64748B`, `#475569`, etc. a mano en
cada `className`. Retematizar = find & replace en ~30 archivos.
- Tras este fix, los grises de texto quedaron en `#64748B` y `#475569` (antes `#CBD5E1` /
  `#94A3B8`). Siguen siendo literales, no tokens.

## 2. Dark mode frágil (`src/index.css`)
El dark mode NO usa variantes `dark:` de Tailwind salvo en `AdminTickets`/`TicketDetail`.
En su lugar, `index.css` tiene un bloque de overrides `.dark .bg-[#XXXX] { ... !important }`
que remapea cada hex concreto. Cada color nuevo que se agregue necesita su override manual
o se rompe en dark. Los `#CBD5E1`/`#94A3B8` que quedaron como `placeholder-` y `dark:text-`
todavía dependen de ese archivo.

## 3. Escala tipográfica sin sistematizar
~9 tamaños distintos en notación arbitraria: `text-[10px] [11px] [12px] [13px] [14px]
[15px] [16px] [22px] [24px] [28px]`. Una escala real serían 5-6 pasos (`text-xs`…`text-2xl`).

## 4. Iconografía mixta (parcialmente resuelto)
- Resuelto en este fix: glifos crudos `× ⚠ ▲ ▼ ↓ ↑` → componentes de `lucide-react`
  (`X`, `AlertTriangle`, `ChevronUp/Down`, `Download`) en 7 archivos.
- Pendiente a propósito (fuera del alcance acordado): las flechas `←` / `→` de back-links
  de navegación y de paginación ("← Anterior", "Siguiente →", "← Tiendas", etc.) siguen
  siendo caracteres de texto en ~23 archivos.
- Pendiente: SVGs hechos a mano (`SunIcon`, `MoonIcon` en `Layout.jsx`/`AdminLayout.jsx`,
  `PencilIcon` en `PosMain.jsx`, la campana inline de notificaciones) podrían pasar a
  lucide (`Sun`, `Moon`, `Pencil`, `Bell`) para unificar.
- `lucide-react` está en `package.json` como `^1.14.0` (versión rara). Conviene fijar una
  versión conocida de lucide y revisar el changelog al actualizar.

## 5. Contraste — lo que quedó sin tocar
El fix subió el texto de contenido a `#64748B`/`#475569` (pasan WCAG AA sobre blanco).
Siguen por debajo del umbral (decisión deliberada, no son "texto de lectura"):
- `placeholder-[#CBD5E1]` (~33 usos) — placeholders de inputs.
- Chart axis ticks: se subieron a `#475569` en `ReportsPage`, pero el resto del chrome de
  Recharts (grid `rgba(0,0,0,0.06)`) sigue muy tenue.

## 6. Bundle
`npm run build` avisa: chunk único de ~1.16 MB (`recharts` + `xlsx` pesan). Falta
code-splitting (`React.lazy` por ruta) o `manualChunks`.
