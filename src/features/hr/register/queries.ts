import "server-only";

import { calcSalary, weekdayOf, type CalcEmployee, type CalcMark } from "../salary/calc";
import { employeesBetween, finalisedMonths, getHrRules, holidaysBetween, marksBetween, monthRange, todayIST } from "../server";
import { buildCell, monthLabel, weekdayName, type Register, type RegisterDay, type RegisterRow } from "./format";

/**
 * The monthly register: one row per person employed on at least one day of the month, one cell
 * per day, and the month's totals. The page and the Excel / CSV export both use this.
 *
 * The days and totals come from the same calculation as the Salary tab (with no salary passed in),
 * so late marks, unmarked days and leave always agree with it. Reads only; never reads salaries.
 */
export async function getRegister(month: string): Promise<Register> {
  const { from, to } = monthRange(month);
  const today = todayIST();
  const [{ rules }, holidays, employees, locked, marks] = await Promise.all([
    getHrRules(),
    holidaysBetween(from, to),
    employeesBetween(from, to, { withSalary: false }),
    finalisedMonths([month]),
    marksBetween(from, to),
  ]);

  const calc = (employee: CalcEmployee, own: CalcMark[]) =>
    calcSalary({ month, employee: { ...employee, monthlySalary: 0 }, marks: own, rules, holidays, today });

  // The month's days (working day, weekly off or holiday) are the same for everyone.
  const calendar = calc({ id: "", name: "", code: "", monthlySalary: 0, joinDate: null, exitDate: null }, []);
  const days: RegisterDay[] = calendar.breakdown.map((d) => {
    const name = weekdayName(weekdayOf(d.date));
    return {
      date: d.date,
      day: Number(d.date.slice(8, 10)),
      weekday: name.slice(0, 1),
      weekdayName: name,
      kind: d.kind,
      holidayName: d.holidayName,
      isToday: d.date === today,
    };
  });

  const marksByEmployee = new Map<string, CalcMark[]>();
  for (const m of marks) {
    const list = marksByEmployee.get(m.employeeId) ?? [];
    list.push({ date: m.date, status: m.status, leaveType: m.leaveType, inTime: m.inTime, outTime: m.outTime });
    marksByEmployee.set(m.employeeId, list);
  }

  const rows: RegisterRow[] = employees.map((employee) => {
    const own = marksByEmployee.get(employee.id) ?? [];
    const line = calc(employee, own);
    const byDate = new Map(own.map((m) => [m.date, m]));
    return {
      id: employee.id,
      name: employee.name,
      code: employee.code,
      designation: employee.designation ?? null,
      cells: line.breakdown.map((day) => buildCell({ name: employee.name, day, mark: byDate.get(day.date) ?? null, today, rules })),
      totals: {
        present: line.days.present,
        halfDays: line.days.halfDays,
        absent: line.days.absent,
        leave: line.days.leavePaid + line.days.leaveUnpaid,
        late: line.days.late,
        unmarked: line.days.unmarked,
        workedMinutes: line.workedMinutes,
      },
    };
  });

  return {
    month,
    label: monthLabel(month),
    today,
    locked: locked.has(month),
    days,
    workingDays: calendar.days.working,
    rows,
    leaveTypes: rules.leaveTypes.map((t) => ({ code: t.code, name: t.name })),
    holidays: holidays.map((h) => ({ date: h.date, name: h.name })),
  };
}
