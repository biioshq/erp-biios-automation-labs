import { cn } from "@/lib/utils";
import { ATTENDANCE_CELL } from "../../components/attendance-badge";
import { dayLabel, unknownLeaveCodes, type Register } from "../format";

function Swatch({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <span aria-hidden className={cn("relative flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md px-1 text-[10px] leading-none font-semibold", className)}>
      {children}
    </span>
  );
}

function Item({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      {swatch}
      <span>{children}</span>
    </li>
  );
}

/** What the codes and colours in the register mean, and the month's holidays. */
export function RegisterLegend({ register }: { register: Register }) {
  const leaveCodes = register.leaveTypes;
  const otherCodes = unknownLeaveCodes(register);
  return (
    <div className="space-y-3 text-xs text-muted-foreground">
      <ul className="flex flex-wrap gap-x-5 gap-y-2" aria-label="What the codes mean">
        <Item swatch={<Swatch className={ATTENDANCE_CELL.present}>P</Swatch>}>Present</Item>
        <Item swatch={<Swatch className={ATTENDANCE_CELL.half_day}>HD</Swatch>}>Half day</Item>
        <Item swatch={<Swatch className={ATTENDANCE_CELL.absent}>A</Swatch>}>Absent</Item>
        {leaveCodes.map((t) => (
          <Item key={t.code} swatch={<Swatch className={ATTENDANCE_CELL.leave}>{t.code}</Swatch>}>
            {t.name}
          </Item>
        ))}
        {otherCodes.map((code) => (
          <Item key={code} swatch={<Swatch className={ATTENDANCE_CELL.leave}>{code}</Swatch>}>
            Leave type no longer in the rules
          </Item>
        ))}
        <Item swatch={<Swatch className={ATTENDANCE_CELL.leave}>L</Swatch>}>Leave, type not given</Item>
        <Item swatch={<Swatch className={ATTENDANCE_CELL.holiday}>H</Swatch>}>Holiday</Item>
        <Item swatch={<Swatch className={ATTENDANCE_CELL.week_off}>WO</Swatch>}>Weekly off</Item>
        <Item
          swatch={
            <Swatch className={ATTENDANCE_CELL.unmarked}>
              <span className="size-1 rounded-full bg-current" />
            </Swatch>
          }
        >
          Not marked
        </Item>
        <Item
          swatch={
            <Swatch className={ATTENDANCE_CELL.present}>
              P
              <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-warning ring-1 ring-card" />
            </Swatch>
          }
        >
          Late
        </Item>
        <Item swatch={<Swatch className="w-6 bg-muted" />}>Weekly off or holiday (shaded column)</Item>
        <Item swatch={<Swatch className="w-6 border border-dashed" />}>Blank: not employed yet, left, or still to come</Item>
      </ul>
      {register.holidays.length ? (
        <p>
          <span className="font-medium text-foreground">Holidays this month: </span>
          {register.holidays.map((h) => `${dayLabel(h.date)} ${h.name}`).join(", ")}
        </p>
      ) : null}
    </div>
  );
}
