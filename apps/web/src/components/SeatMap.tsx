import type { PublicSeat } from '../api/types';

type Props = { seats: PublicSeat[]; selected: string[]; onToggle: (seatLabel: string) => void; maxSeats: number };

export function SeatMap({ seats, selected, onToggle, maxSeats }: Props) {
  const rows = seats.reduce<Record<string, PublicSeat[]>>((grouped, seat) => {
    (grouped[seat.rowLabel] ??= []).push(seat);
    return grouped;
  }, {});

  return (
    <div className="space-y-6">
      <div className="mx-auto h-1.5 w-full max-w-md rounded-full bg-linear-to-r from-transparent via-amber-400/70 to-transparent" />
      <p className="text-center text-xs uppercase tracking-widest text-stone-500">Tela</p>

      <div className="space-y-2 overflow-x-auto">
        {Object.entries(rows).map(([rowLabel, rowSeats]) => (
          <div key={rowLabel} className="flex items-center justify-center gap-1.5">
            <span className="w-5 shrink-0 text-xs font-medium text-stone-500">{rowLabel}</span>
            {rowSeats.map((seat) => {
              const isSelected = selected.includes(seat.seatLabel);
              const atLimit = !isSelected && selected.length >= maxSeats;
              const disabled = !seat.available || atLimit;
              return (
                <button
                  key={seat.id}
                  type="button"
                  disabled={disabled}
                  aria-pressed={isSelected}
                  aria-label={`Assento ${seat.seatLabel}${seat.available ? '' : ' (ocupado)'}`}
                  onClick={() => onToggle(seat.seatLabel)}
                  className={[
                    'size-8 shrink-0 rounded-t-lg border text-[11px] font-medium transition',
                    isSelected ? 'border-amber-400 bg-amber-400 text-stone-950' : '',
                    !isSelected && seat.available ? 'border-stone-600 bg-stone-800 text-stone-300 hover:border-amber-400/70' : '',
                    !seat.available ? 'cursor-not-allowed border-stone-800 bg-stone-900 text-stone-700 line-through' : '',
                    atLimit ? 'cursor-not-allowed opacity-40' : '',
                  ].join(' ')}
                >
                  {seat.seatNumber}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap justify-center gap-5 text-xs text-stone-400">
        <span className="flex items-center gap-2"><span className="size-3 rounded-sm border border-stone-600 bg-stone-800" /> Livre</span>
        <span className="flex items-center gap-2"><span className="size-3 rounded-sm bg-amber-400" /> Selecionado</span>
        <span className="flex items-center gap-2"><span className="size-3 rounded-sm bg-stone-900 ring-1 ring-stone-800" /> Ocupado</span>
      </div>
    </div>
  );
}
