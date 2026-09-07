// Footer discreto "powered by" — Vexio es un producto de Syntra Technology.

const SyntraFooter = ({ variant = 'flow' }) => {
  const positionClass =
    variant === 'fixed'
      ? 'absolute bottom-0 left-0 right-0'
      : 'shrink-0';

  return (
    <footer
      className={`${positionClass} py-3 px-4 flex items-center justify-center gap-1.5 select-none print:hidden`}
    >
      <img
        src="/syntra-icon-gray.png"
        alt=""
        width="16"
        height="16"
        className="w-4 h-4 opacity-70"
      />
      <span className="hidden min-[380px]:inline text-[11px] sm:text-[12px] text-[#737373] tracking-wide">
        Desarrollado por Syntra Technology
      </span>
    </footer>
  );
};

export default SyntraFooter;
