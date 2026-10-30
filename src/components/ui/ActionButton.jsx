// Bottone con stato: in attesa mostra i mini-rulli e il verbo in corso ("Creo…"), alla fine un lampo
// di conferma. Stesse classi .btn di sempre (secondary, tiny...).
import { useEffect, useRef, useState } from "react";

/**
 * @param {{busy?: boolean, busyLabel?: string, doneLabel?: string, className?: string}} props
 *   busy: azione in corso; busyLabel: testo durante l'attesa; doneLabel: testo per 1,4 s a fine azione.
 */
export default function ActionButton({ busy = false, busyLabel, doneLabel, className = "btn", children, disabled, ...rest }) {
  const [done, setDone] = useState(false);
  const was = useRef(busy);
  useEffect(() => {
    if (was.current && !busy && doneLabel) {
      setDone(true);
      const t = setTimeout(() => setDone(false), 1400);
      was.current = busy;
      return () => clearTimeout(t);
    }
    was.current = busy;
  }, [busy, doneLabel]);
  return (
    <button className={className} aria-busy={busy || undefined} data-done={done || undefined} disabled={disabled || busy} {...rest}>
      {busy ? (
        <>
          <span className="mini-reels" aria-hidden="true"><i /><i /><i /></span>
          <span>{busyLabel || children}</span>
        </>
      ) : done ? (
        <span>{doneLabel}</span>
      ) : (
        children
      )}
    </button>
  );
}
