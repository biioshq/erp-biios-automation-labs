/**
 * Seeds a realistic dataset for Biios Automation Labs: team, projects, inventory
 * (bought, assigned and returned through the real ledger, so expenses, allocations,
 * movements and low-stock notifications are all consistent), manual expenses with
 * GST, income and tasks.
 *
 *   npm run seed            seed an empty database (skips if projects exist)
 *   npm run seed -- --reset drop everything first
 *
 * The admin signs in as erp-bal@biios.in. Every seeded account uses the password in
 * SEED_PASSWORD (default ERPbiios#2026). On a database seeded before this login existed,
 * the old admin (mahir@biios.in) is renamed once and the demo passwords are reset.
 */
import mongoose, { Types } from "mongoose";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { connectDB } from "@/server/db";
import {
  Employee,
  Expense,
  FileModel,
  ProjectMember,
  RecurringExpense,
  Income,
  InventoryCategory,
  InventoryItem,
  Project,
  Task,
  User,
} from "@/server/models";
import { nextNumber } from "@/server/services/numbering";
import { assignToProject, purchaseStock, returnFromProject } from "@/server/services/inventory-ledger";
import { saveUpload } from "@/server/storage";
import { postDueRecurringExpenses } from "@/server/services/recurring";
import { firstOccurrence } from "@/lib/recurrence";
import { addDays, fromDateInput, startOfDayIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { splitGst } from "@/lib/gst";
import type { ExpenseCategory, IncomeCategory, PaymentMethod, ProjectStage, TaskPriority, TaskStatus } from "@/lib/constants";

const PASSWORD = process.env.SEED_PASSWORD ?? "ERPbiios#2026";
const ADMIN_EMAIL = "erp-bal@biios.in";
/** The admin's email in databases seeded before the shared ERP login. */
const LEGACY_ADMIN_EMAIL = "mahir@biios.in";
const RESET = process.argv.includes("--reset");

/* Deterministic randomness so every seed looks the same. */
let state = 20261119;
function rand() {
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
const between = (min: number, max: number) => min + rand() * (max - min);
const today = startOfDayIST();
const daysAgo = (n: number) => addDays(today, -n);

/* GSTINs with valid check digits. */
const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function gstin(stateCode: string, pan: string, entity = "1") {
  const base = `${stateCode}${pan}${entity}Z`;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(base[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return base + GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

/** A plausible PAN for a business name: 3 letters, entity type C, name initial, 4 digits, a letter. */
function panFor(name: string, salt = 0) {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "").padEnd(6, "X");
  const digits = String(1000 + ((name.length * 131 + salt * 17) % 9000)).slice(0, 4);
  return `${letters.slice(0, 3)}C${letters[0]}${digits}${letters[(name.length + salt) % letters.length] ?? "K"}`;
}

const VENDORS = [
  { name: "Shree Ganesh Electricals Pvt Ltd", gstin: gstin("27", "AAPCS4821K"), address: "Plot 14, MIDC Bhosari, Pune, Maharashtra 411026" },
  { name: "Pune Wire & Cable Co.", gstin: gstin("27", "AAKFP7712M"), address: "Shop 3, Budhwar Peth, Pune, Maharashtra 411002" },
  { name: "Robu Electronics", gstin: gstin("27", "AAGCR1987B"), address: "Kasba Peth, Pune, Maharashtra 411011" },
  { name: "Bengaluru Sensor Works LLP", gstin: gstin("29", "AAQFB2231C"), address: "Peenya Industrial Area, Bengaluru, Karnataka 560058" },
  { name: "Delhi Enclosures India", gstin: gstin("07", "AADCD8814P"), address: "Okhla Phase II, New Delhi 110020" },
  { name: "Tata Steel Distributors", gstin: gstin("27", "AABCT3518Q"), address: "Chakan MIDC, Pune, Maharashtra 410501" },
  { name: "Hindalco Metal Mart", gstin: gstin("27", "AAACH1201R"), address: "Pimpri, Pune, Maharashtra 411018" },
  { name: "Mean Well Power India", gstin: gstin("33", "AAJCM4410D"), address: "Ambattur, Chennai, Tamil Nadu 600058" },
];

const OVERHEAD_VENDORS: { name: string; category: ExpenseCategory; amount: [number, number]; gstRate: number; vendor?: (typeof VENDORS)[number]; sac?: string }[] = [
  { name: "MSEDCL", category: "utilities", amount: [9000, 16000], gstRate: 0 },
  { name: "Vercel", category: "software", amount: [1700, 2600], gstRate: 18, sac: "998315" },
  { name: "Uber for Business", category: "travel", amount: [1800, 6500], gstRate: 5, sac: "996412" },
  { name: "Blue Dart", category: "logistics", amount: [900, 4200], gstRate: 18, sac: "996812" },
  { name: "Meta Ads", category: "marketing", amount: [12000, 40000], gstRate: 18, sac: "998365" },
  { name: "Staples Office Supplies", category: "office", amount: [1500, 7500], gstRate: 18, sac: "4820" },
];

const PROJECT_VENDOR_SPEND: { category: ExpenseCategory; stage: ProjectStage; desc: string; amount: [number, number]; vendor?: string; sac?: string }[] = [
  { category: "professional_fees", stage: "research", desc: "Site survey and wiring audit", amount: [12000, 30000], vendor: "Kale Electrical Consultants", sac: "998331" },
  { category: "contractors", stage: "design", desc: "Lighting and automation layout drawings", amount: [18000, 45000], vendor: "Studio Nine Design", sac: "998391" },
  { category: "materials", stage: "prototype", desc: "Prototype PCB fabrication", amount: [8000, 22000], vendor: "PCB Power Market", sac: "8534" },
  { category: "labour", stage: "development", desc: "Electrician team, retrofit installation", amount: [25000, 90000], vendor: "Om Sai Electrical Works", sac: "995461" },
  { category: "equipment", stage: "testing", desc: "Thermal camera rental for load testing", amount: [6000, 15000], vendor: "Instru Rentals", sac: "997319" },
  { category: "logistics", stage: "deployment", desc: "Transport of panels to site", amount: [2500, 9000], vendor: "VRL Logistics", sac: "996511" },
  { category: "contractors", stage: "production", desc: "Enclosure powder coating", amount: [9000, 26000], vendor: "Shubham Coatings", sac: "998873" },
  { category: "travel", stage: "deployment", desc: "Site visits", amount: [1500, 6000], vendor: "Uber for Business", sac: "996412" },
];

/** Demo project names by short key, so an older database can be matched by name. */
const PROJECT_NAMES: [string, string][] = [
  ["alpha", "Sharma Villa Retrofit"],
  ["office", "Hinjewadi Office Automation"],
  ["hub", "Biios Hub v2 Prototype"],
  ["kp", "Koregaon Park Penthouse"],
  ["demo", "Showroom Demo Wall"],
  ["clinic", "Wakad Clinic Lighting"],
];

const TEAM = [
  { name: "Mahir Shah", email: ADMIN_EMAIL, role: "admin" },
  { name: "Aarav Mehta", email: "aarav@biios.in", role: "member" },
  { name: "Priya Kulkarni", email: "priya@biios.in", role: "member" },
  { name: "Rohan Desai", email: "rohan@biios.in", role: "member" },
  { name: "Sneha Patil", email: "sneha@biios.in", role: "member" },
] as const;

async function ensureUsers() {
  // Imported after a --reset drop, so Better Auth builds its indexes on the fresh database.
  const { allowAccountCreation, auth } = await import("@/server/auth/auth");
  const ids: Record<string, string> = {};

  // One-time move to the shared admin login: rename the old admin account (keeping its id,
  // history and sessions) and give every demo account the current password.
  const legacy = await User.findOne({ email: LEGACY_ADMIN_EMAIL }).lean();
  if (legacy && !(await User.exists({ email: ADMIN_EMAIL }))) {
    const ctx = await auth.$context;
    const hash = await ctx.password.hash(PASSWORD);
    await User.updateOne({ _id: legacy._id }, { $set: { email: ADMIN_EMAIL, role: "admin", updatedAt: new Date() } });
    for (const member of TEAM) {
      const u = await User.findOne({ email: member.email }).lean();
      if (u) await ctx.internalAdapter.updatePassword(String(u._id), hash);
    }
    console.log(`Admin login moved from ${LEGACY_ADMIN_EMAIL} to ${ADMIN_EMAIL}; demo passwords reset.`);
  }

  for (const member of TEAM) {
    const existing = await User.findOne({ email: member.email }).lean();
    if (existing) {
      ids[member.email] = String(existing._id);
      continue;
    }
    const result = await allowAccountCreation.run(true, () =>
      auth.api.signUpEmail({ body: { name: member.name, email: member.email, password: PASSWORD } }),
    );
    await User.updateOne({ _id: result.user.id }, { $set: { role: member.role } });
    ids[member.email] = result.user.id;
  }
  return ids;
}

/** A simple GST tax invoice image, so seeded expenses have receipts to preview. */
async function invoiceImage(v: { vendor: string; address: string; gstin: string; number: string; date: Date; lines: [string, string, number][]; taxable: number; cgst: number; sgst: number; igst: number; total: number }) {
  const font = GlobalFonts.families.some((f) => f.family === "DejaVu Sans") ? "DejaVu Sans" : "sans-serif";
  const canvas = createCanvas(1240, 1600);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1240, 1600);
  ctx.fillStyle = "#111111";
  let y = 90;
  const text = (s: string, size = 26, x = 80, bold = false) => {
    ctx.font = `${bold ? "bold " : ""}${size}px "${font}"`;
    ctx.fillText(s, x, y);
    y += size + 18;
  };
  text("TAX INVOICE", 36, 500, true);
  y += 10;
  text(v.vendor, 34, 80, true);
  text(v.address, 24);
  text(`GSTIN: ${v.gstin}`, 26);
  y += 20;
  text(`Invoice No: ${v.number}`, 26);
  text(`Invoice Date: ${toDateInput(v.date).split("-").reverse().join("/")}`, 26);
  text("Bill To: Biios Automation Labs, Baner, Pune", 24);
  y += 20;
  text("Description                         HSN/SAC        Amount", 24, 80, true);
  for (const [desc, hsn, amount] of v.lines) text(`${desc.padEnd(34).slice(0, 34)}  ${hsn.padEnd(12)}  ${amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 24);
  y += 20;
  const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2 });
  text(`Taxable Value                                   ${money(v.taxable)}`, 26);
  if (v.igst) text(`IGST @ 18%                                       ${money(v.igst)}`, 26);
  else {
    text(`CGST @ 9%                                         ${money(v.cgst)}`, 26);
    text(`SGST @ 9%                                         ${money(v.sgst)}`, 26);
  }
  text(`Grand Total                              Rs. ${money(v.total)}`, 30, 80, true);
  y += 20;
  text("Payment Mode: NEFT", 24);
  return canvas.toBuffer("image/png");
}

type ProjectRef = { id: Types.ObjectId; start: Date; end: Date | null };

/**
 * Employees, project teams and recurring schedules (salaries, rent, bills), then lets the
 * scheduler post what is due. Runs on a fresh database, and on an older demo database that
 * has projects but no employees yet (bills then start today, since that data already has
 * its bills entered by hand; salaries are backfilled for the past year either way).
 */
async function seedPeopleAndSchedules({
  users,
  admin,
  projects,
  backfillBills,
}: {
  users: Record<string, string>;
  admin: string;
  projects: Record<string, ProjectRef>;
  backfillBills: boolean;
}) {
  /* Employees and project teams */
  const employeeSpecs = [
    { key: "mahir", name: "Mahir Shah", email: "mahir@biios.in", designation: "Founder & CEO", department: "management", type: "full_time", salary: 120000, joined: 900 },
    { key: "aarav", name: "Aarav Mehta", email: "aarav@biios.in", designation: "Firmware Engineer", department: "engineering", type: "full_time", salary: 75000, joined: 620 },
    { key: "priya", name: "Priya Kulkarni", email: "priya@biios.in", designation: "Product Designer", department: "design", type: "full_time", salary: 60000, joined: 540 },
    { key: "rohan", name: "Rohan Desai", email: "rohan@biios.in", designation: "Installation Lead", department: "installation", type: "full_time", salary: 45000, joined: 480 },
    { key: "sneha", name: "Sneha Patil", email: "sneha@biios.in", designation: "Operations Manager", department: "operations", type: "full_time", salary: 55000, joined: 450 },
    { key: "ananya", name: "Ananya Rao", email: "ananya@biios.in", designation: "Hardware Engineer", department: "engineering", type: "full_time", salary: 70000, joined: 300 },
    { key: "vikram", name: "Vikram Joshi", email: "vikram@biios.in", designation: "Field Electrician", department: "installation", type: "full_time", salary: 28000, joined: 400 },
    { key: "kunal", name: "Kunal Pawar", email: "kunal@biios.in", designation: "Field Electrician", department: "installation", type: "contract", salary: 25000, joined: 260 },
    { key: "farhan", name: "Farhan Shaikh", email: "farhan@biios.in", designation: "Sales Executive", department: "sales", type: "full_time", salary: 35000, joined: 210 },
    { key: "meera", name: "Meera Iyer", email: "meera@biios.in", designation: "Accounts Executive", department: "finance", type: "part_time", salary: 32000, joined: 180 },
    { key: "isha", name: "Isha Kulkarni", email: "isha@biios.in", designation: "Firmware Intern", department: "engineering", type: "intern", salary: 12000, joined: 95 },
  ] as const;
  const employees: Record<string, Types.ObjectId> = {};
  const yearAgo = daysAgo(365);
  const billStart = backfillBills ? yearAgo : today;
  let scheduleCount = 0;
  const addSchedule = async (spec: {
    name: string;
    vendor: string;
    category: ExpenseCategory;
    amount: number;
    frequency: "monthly" | "quarterly" | "yearly";
    dayOfMonth: number;
    start: Date;
    gstRate?: 0 | 5 | 12 | 18 | 28;
    gstin?: string;
    hsnSac?: string;
    employee?: Types.ObjectId;
    project?: Types.ObjectId;
    stage?: ProjectStage;
  }) => {
    const doc = await RecurringExpense.create({
      code: await nextNumber("recurring"),
      name: spec.name,
      vendor: spec.vendor,
      category: spec.category,
      amount: spec.amount,
      gstRate: spec.gstRate ?? 0,
      gstin: spec.gstin,
      hsnSac: spec.hsnSac,
      paymentMethod: "bank_transfer",
      employee: spec.employee,
      project: spec.project,
      stage: spec.stage,
      frequency: spec.frequency,
      dayOfMonth: spec.dayOfMonth,
      startDate: spec.start,
      nextRunDate: firstOccurrence(spec.start, spec.frequency, spec.dayOfMonth),
      status: "active",
      createdBy: new Types.ObjectId(admin),
    });
    scheduleCount++;
    return doc._id;
  };

  for (const e of employeeSpecs) {
    const joinDate = daysAgo(e.joined);
    // Mahir's staff record keeps his own email; his sign-in is the shared admin login.
    const userId = users[e.email] ?? (e.key === "mahir" ? users[ADMIN_EMAIL] : undefined);
    const doc = await Employee.create({
      code: await nextNumber("employee"),
      name: e.name,
      email: e.email,
      phone: `+91 98${Math.floor(between(10000000, 99999999))}`,
      designation: e.designation,
      department: e.department,
      employmentType: e.type,
      status: "active",
      joinDate,
      monthlySalary: e.salary,
      user: userId ? new Types.ObjectId(userId) : undefined,
      createdBy: new Types.ObjectId(admin),
    });
    employees[e.key] = doc._id;
    // Salary: paid on the last day of each month, from the later of joining or a year ago.
    const schedule = await addSchedule({
      name: `Salary: ${e.name}`,
      vendor: e.name,
      category: "salaries",
      amount: e.salary,
      frequency: "monthly",
      dayOfMonth: 31,
      start: joinDate > yearAgo ? joinDate : yearAgo,
      employee: doc._id,
    });
    await Employee.updateOne({ _id: doc._id }, { $set: { salaryRecurring: schedule } });
  }

  const teams: [string, string, string, number, boolean?][] = [
    ["alpha", "rohan", "Installation lead", 60],
    ["alpha", "vikram", "Electrician", 70],
    ["alpha", "kunal", "Electrician", 60],
    ["alpha", "priya", "Lighting design", 30],
    ["office", "sneha", "Project lead", 60],
    ["office", "aarav", "Firmware", 50],
    ["office", "rohan", "Installation lead", 40],
    ["office", "vikram", "Electrician", 30],
    ["office", "farhan", "Client relations", 20],
    ["hub", "aarav", "Product lead", 50],
    ["hub", "ananya", "Hardware", 100],
    ["hub", "isha", "Firmware", 100],
    ["hub", "priya", "Industrial design", 40],
    ["kp", "priya", "Design lead", 30],
    ["kp", "farhan", "Sales", 30],
    ["demo", "priya", "Design", 50, true],
    ["demo", "kunal", "Electrician", 40, true],
    ["clinic", "sneha", "Project lead", 10],
  ];
  for (const [project, person, role, allocation, ended] of teams) {
    const p = projects[project];
    if (!p) continue;
    const pastEnd = p.end && p.end.getTime() < Date.now() ? p.end : daysAgo(1);
    await ProjectMember.create({
      project: p.id,
      employee: employees[person],
      role,
      allocation,
      startDate: p.start,
      endDate: ended ? pastEnd : null,
      createdBy: new Types.ObjectId(admin),
    });
  }

  // Fixed bills and subscriptions.
  await addSchedule({ name: "Office rent", vendor: "WeWork Baner", category: "rent", amount: 100300, frequency: "monthly", dayOfMonth: 5, start: billStart, gstRate: 18, gstin: gstin("27", panFor("WeWork Baner")), hsnSac: "997212" });
  await addSchedule({ name: "Internet leased line", vendor: "Airtel Business", category: "utilities", amount: 4130, frequency: "monthly", dayOfMonth: 10, start: billStart, gstRate: 18, gstin: gstin("27", panFor("Airtel Business")), hsnSac: "998422" });
  await addSchedule({ name: "Google Workspace", vendor: "Google Workspace", category: "software", amount: 6962, frequency: "monthly", dayOfMonth: 1, start: billStart, gstRate: 18, gstin: gstin("29", panFor("Google India")), hsnSac: "998315" });
  await addSchedule({ name: "Figma Professional", vendor: "Figma", category: "software", amount: 4602, frequency: "monthly", dayOfMonth: 15, start: billStart, gstRate: 18, hsnSac: "998315" });
  await addSchedule({ name: "Quarterly accounts and GST filing", vendor: "Joshi & Associates (CA)", category: "professional_fees", amount: 21240, frequency: "quarterly", dayOfMonth: 10, start: billStart, gstRate: 18, gstin: gstin("27", panFor("Joshi Associates")), hsnSac: "998221" });
  await addSchedule({ name: "Hub cloud hosting", vendor: "Amazon Web Services", category: "software", amount: 8850, frequency: "monthly", dayOfMonth: 3, start: backfillBills ? daysAgo(280) : today, gstRate: 18, hsnSac: "998315", project: projects.hub?.id, stage: "development" });
  await addSchedule({ name: "Domain and SSL renewal", vendor: "GoDaddy India", category: "software", amount: 3540, frequency: "yearly", dayOfMonth: 20, start: backfillBills ? daysAgo(330) : today, gstRate: 18, hsnSac: "998315" });

  // Let the scheduler post a year of salaries and bills, exactly as it does in production.
  const posted = await postDueRecurringExpenses();
  console.log(`Employees: ${employeeSpecs.length}, team memberships: ${teams.length}, recurring schedules: ${scheduleCount}, posted ${posted.posted} recurring expenses`);

}

async function main() {
  await connectDB();
  if (RESET) {
    await mongoose.connection.db!.dropDatabase();
    console.log("Database dropped.");
  }
  const users = await ensureUsers();
  const admin = users[ADMIN_EMAIL]!;
  const people = Object.values(users);

  if ((await Project.estimatedDocumentCount()) > 0) {
    if ((await Employee.estimatedDocumentCount()) === 0) {
      const docs = await Project.find({ name: { $in: PROJECT_NAMES.map(([, name]) => name) } }, { name: 1, startDate: 1, endDate: 1 }).lean();
      const projects: Record<string, ProjectRef> = {};
      for (const [short, name] of PROJECT_NAMES) {
        const doc = docs.find((d) => d.name === name);
        if (doc) projects[short] = { id: doc._id, start: doc.startDate ?? daysAgo(180), end: doc.endDate ?? null };
      }
      await seedPeopleAndSchedules({ users, admin, projects, backfillBills: false });
      console.log("Added employees, project teams and recurring schedules to the existing data.");
    } else {
      console.log("Projects and employees already exist; nothing to add. Use --reset to start over.");
    }
    return;
  }

  /* Projects */
  const projectSpecs = [
    { name: "Sharma Villa Retrofit", short: "alpha", client: "Sharma Residence, Baner", status: "active", budget: 1200000, start: 150, end: -45, color: "#4a82cc", description: "Whole-home retrofit: 42 switches, 6 curtains, 3 ACs and door sensors without rewiring." },
    { name: "Hinjewadi Office Automation", short: "office", client: "Nexus Tech Park", status: "active", budget: 2500000, start: 210, end: -90, color: "#ff8800", description: "Occupancy-based lighting and HVAC control across two floors, with an energy dashboard." },
    { name: "Biios Hub v2 Prototype", short: "hub", client: "Biios Internal R&D", status: "active", budget: 800000, start: 300, end: -20, color: "#2fc4b2", description: "Next-generation hub: ESP32-S3, Matter support and a smaller enclosure." },
    { name: "Koregaon Park Penthouse", short: "kp", client: "Mrs. Anjali Rao", status: "planning", budget: 650000, start: -10, end: -120, color: "#a48bf5", description: "Scene-based lighting, curtains and security for a 4BHK penthouse." },
    { name: "Showroom Demo Wall", short: "demo", client: "Biios Experience Centre", status: "active", budget: 300000, start: 330, end: 240, color: "#f06f98", description: "Interactive demo wall for the Baner experience centre." },
    { name: "Wakad Clinic Lighting", short: "clinic", client: "Wellness First Clinic", status: "on_hold", budget: 240000, start: 60, end: -60, color: "#f5b83d", description: "Circadian lighting for consultation rooms. Paused until the clinic's interiors are finished." },
  ] as const;
  const projects: Record<string, Types.ObjectId> = {};
  for (const p of projectSpecs) {
    const doc = await Project.create({
      code: await nextNumber("project"),
      name: p.name,
      client: p.client,
      description: p.description,
      status: p.status,
      budget: p.budget,
      startDate: daysAgo(p.start),
      endDate: daysAgo(p.end),
      color: p.color,
      stageBudgets: {
        research: round2(p.budget * 0.05),
        design: round2(p.budget * 0.1),
        prototype: round2(p.budget * 0.1),
        development: round2(p.budget * 0.4),
        testing: round2(p.budget * 0.1),
        production: round2(p.budget * 0.15),
        deployment: round2(p.budget * 0.1),
      },
      createdBy: new Types.ObjectId(admin),
    });
    projects[p.short] = doc._id;
    // Backdate creation to the project start so timelines read naturally.
    await Project.collection.updateOne({ _id: doc._id }, { $set: { createdAt: daysAgo(p.start + 5) } });
  }
  console.log(`Projects: ${projectSpecs.length}`);

  /* Inventory */
  const categorySpecs = [
    ["Relays & Modules", "#4a82cc"],
    ["Wiring & Cables", "#ff8800"],
    ["Sensors", "#2fc4b2"],
    ["Controllers & Boards", "#a48bf5"],
    ["Metals & Enclosures", "#f06f98"],
    ["Power Supplies", "#f5b83d"],
  ] as const;
  const categories: Record<string, Types.ObjectId> = {};
  for (const [name, color] of categorySpecs) categories[name] = (await InventoryCategory.create({ name, color }))._id;

  const itemSpecs = [
    { name: "Steel Rods", sku: "MTL-STL-ROD", cat: "Metals & Enclosures", unit: "pcs", min: 50, price: 420, vendor: VENDORS[5]! },
    { name: "Copper Wire 1.5 sq mm", sku: "WIR-CU-1.5", cat: "Wiring & Cables", unit: "m", min: 20, price: 65, vendor: VENDORS[1]! },
    { name: "Aluminium Sheet 2mm", sku: "MTL-AL-2MM", cat: "Metals & Enclosures", unit: "sheet", min: 25, price: 1850, vendor: VENDORS[6]! },
    { name: "Smart Relay Module 4CH", sku: "RLY-4CH", cat: "Relays & Modules", unit: "pcs", min: 30, price: 450, vendor: VENDORS[0]! },
    { name: "Wi-Fi Switch Module 2CH", sku: "RLY-WIFI-2CH", cat: "Relays & Modules", unit: "pcs", min: 40, price: 380, vendor: VENDORS[0]! },
    { name: "Curtain Motor Controller", sku: "RLY-CURTAIN", cat: "Relays & Modules", unit: "pcs", min: 8, price: 2350, vendor: VENDORS[0]! },
    { name: "ESP32-S3 Dev Board", sku: "CTL-ESP32S3", cat: "Controllers & Boards", unit: "pcs", min: 25, price: 690, vendor: VENDORS[2]! },
    { name: "Biios Hub Mainboard v2", sku: "CTL-HUB-V2", cat: "Controllers & Boards", unit: "pcs", min: 10, price: 3200, vendor: VENDORS[2]! },
    { name: "PIR Motion Sensor", sku: "SNS-PIR", cat: "Sensors", unit: "pcs", min: 30, price: 240, vendor: VENDORS[3]! },
    { name: "Door Contact Sensor", sku: "SNS-DOOR", cat: "Sensors", unit: "pcs", min: 30, price: 310, vendor: VENDORS[3]! },
    { name: "Temperature & Humidity Sensor", sku: "SNS-TH", cat: "Sensors", unit: "pcs", min: 20, price: 280, vendor: VENDORS[3]! },
    { name: "Flexible Conduit 20mm", sku: "WIR-CONDUIT-20", cat: "Wiring & Cables", unit: "m", min: 100, price: 22, vendor: VENDORS[1]! },
    { name: "ABS Enclosure 120x80", sku: "ENC-ABS-120", cat: "Metals & Enclosures", unit: "pcs", min: 40, price: 145, vendor: VENDORS[4]! },
    { name: "12V 2A SMPS", sku: "PWR-12V-2A", cat: "Power Supplies", unit: "pcs", min: 25, price: 330, vendor: VENDORS[7]! },
    { name: "5V DIN Rail Supply", sku: "PWR-5V-DIN", cat: "Power Supplies", unit: "pcs", min: 15, price: 890, vendor: VENDORS[7]! },
  ] as const;

  // Purchases: [sku, qty, daysAgo, priceFactor]
  const purchases: [string, number, number, number][] = [
    ["MTL-STL-ROD", 200, 260, 1],
    ["WIR-CU-1.5", 100, 250, 1],
    ["MTL-AL-2MM", 150, 245, 1],
    ["RLY-4CH", 120, 240, 1],
    ["RLY-4CH", 80, 90, 1.06],
    ["RLY-WIFI-2CH", 200, 235, 1],
    ["RLY-CURTAIN", 24, 230, 1],
    ["CTL-ESP32S3", 60, 225, 1],
    ["CTL-ESP32S3", 40, 70, 0.95],
    ["CTL-HUB-V2", 30, 140, 1],
    ["SNS-PIR", 150, 220, 1],
    ["SNS-DOOR", 90, 220, 1],
    ["SNS-TH", 40, 200, 1],
    ["WIR-CONDUIT-20", 600, 215, 1],
    ["ENC-ABS-120", 150, 210, 1],
    ["PWR-12V-2A", 80, 205, 1],
    ["PWR-5V-DIN", 30, 120, 1],
  ];

  const items: Record<string, Types.ObjectId> = {};
  for (const spec of itemSpecs) {
    const doc = await InventoryItem.create({
      name: spec.name,
      sku: spec.sku,
      category: categories[spec.cat],
      unit: spec.unit,
      minStock: spec.min,
      unitPrice: spec.price,
      vendor: spec.vendor.name,
    });
    items[spec.sku] = doc._id;
  }

  for (const [sku, qty, ago, factor] of purchases) {
    const spec = itemSpecs.find((s) => s.sku === sku)!;
    const price = round2(spec.price * factor);
    const taxable = round2(qty * price);
    const interState = spec.vendor.gstin.slice(0, 2) !== "27";
    const tax = splitGst(taxable, 18, interState);
    await purchaseStock(
      {
        itemId: String(items[sku]),
        quantity: qty,
        unitPrice: price,
        vendor: spec.vendor.name,
        date: daysAgo(ago),
        invoice: {
          number: `${spec.vendor.name.slice(0, 3).toUpperCase()}/${2026}/${Math.floor(between(100, 999))}`,
          date: daysAgo(ago),
          gstin: spec.vendor.gstin,
          taxableAmount: taxable,
          ...tax,
          cess: 0,
          hsnSac: sku.startsWith("WIR") ? "8544" : sku.startsWith("MTL") ? "7214" : sku.startsWith("SNS") ? "9026" : sku.startsWith("PWR") ? "8504" : "8536",
          total: round2(taxable + tax.cgst + tax.sgst + tax.igst),
        },
      },
      admin,
    );
  }

  // Assignments: [sku, project, qty, stage, daysAgo]
  const assignments: [string, string, number, ProjectStage, number][] = [
    ["MTL-STL-ROD", "alpha", 20, "development", 120],
    ["WIR-CU-1.5", "alpha", 50, "development", 118],
    ["WIR-CU-1.5", "office", 38, "development", 80],
    ["MTL-AL-2MM", "office", 90, "production", 100],
    ["MTL-AL-2MM", "hub", 40, "prototype", 85],
    ["MTL-AL-2MM", "demo", 20, "production", 230],
    ["RLY-4CH", "alpha", 42, "development", 110],
    ["RLY-4CH", "office", 96, "development", 75],
    ["RLY-4CH", "demo", 12, "production", 228],
    ["RLY-WIFI-2CH", "office", 60, "development", 70],
    ["RLY-WIFI-2CH", "alpha", 18, "development", 105],
    ["RLY-CURTAIN", "alpha", 6, "deployment", 60],
    ["RLY-CURTAIN", "office", 12, "deployment", 40],
    ["CTL-ESP32S3", "hub", 35, "prototype", 150],
    ["CTL-ESP32S3", "office", 22, "development", 65],
    ["CTL-HUB-V2", "hub", 12, "testing", 50],
    ["CTL-HUB-V2", "alpha", 3, "deployment", 45],
    ["SNS-PIR", "office", 64, "development", 72],
    ["SNS-PIR", "alpha", 14, "development", 100],
    ["SNS-DOOR", "alpha", 22, "development", 98],
    ["SNS-DOOR", "office", 40, "development", 68],
    ["SNS-TH", "office", 24, "testing", 55],
    ["WIR-CONDUIT-20", "alpha", 180, "development", 115],
    ["WIR-CONDUIT-20", "office", 260, "development", 78],
    ["ENC-ABS-120", "hub", 30, "prototype", 140],
    ["ENC-ABS-120", "office", 70, "production", 60],
    ["PWR-12V-2A", "office", 48, "development", 66],
    ["PWR-12V-2A", "alpha", 16, "development", 95],
    ["PWR-5V-DIN", "office", 12, "deployment", 38],
  ];
  for (const [sku, project, qty, stage, ago] of assignments) {
    await assignToProject({ itemId: String(items[sku]), projectId: String(projects[project]), quantity: qty, stage, date: daysAgo(ago) }, admin);
  }
  // A couple of returns.
  await returnFromProject({ itemId: String(items["RLY-4CH"]), projectId: String(projects.office), quantity: 6, date: daysAgo(30), note: "Unused after final count" }, admin);
  await returnFromProject({ itemId: String(items["WIR-CONDUIT-20"]), projectId: String(projects.alpha), quantity: 25, date: daysAgo(28), note: "Leftover after installation" }, admin);
  // The showroom wall was finished after its stock went in.
  await Project.updateOne({ _id: projects.demo }, { $set: { status: "completed" } });
  console.log(`Inventory: ${itemSpecs.length} items, ${purchases.length} purchases, ${assignments.length} assignments, 2 returns`);

  /* Manual expenses */
  let expenseCount = 0;
  const addExpense = async (e: {
    vendor: string;
    vendorAddress?: string;
    gstin?: string;
    category: ExpenseCategory;
    amountTaxable: number;
    rate: number;
    interState?: boolean;
    date: Date;
    project?: Types.ObjectId;
    stage?: ProjectStage;
    description?: string;
    hsnSac?: string;
    payment?: PaymentMethod;
    withReceipt?: boolean;
  }) => {
    const taxable = round2(e.amountTaxable);
    const tax = splitGst(taxable, e.rate, Boolean(e.interState));
    const total = round2(taxable + tax.cgst + tax.sgst + tax.igst);
    const invoiceNumber = e.rate > 0 ? `INV-${Math.floor(between(1000, 9999))}` : undefined;
    let receipt: Types.ObjectId | undefined;
    if (e.withReceipt && e.gstin) {
      const png = await invoiceImage({
        vendor: e.vendor,
        address: e.vendorAddress ?? "Pune, Maharashtra",
        gstin: e.gstin,
        number: invoiceNumber ?? "NA",
        date: e.date,
        lines: [[e.description ?? "Services", e.hsnSac ?? "998313", taxable]],
        taxable,
        cgst: tax.cgst,
        sgst: tax.sgst,
        igst: tax.igst,
        total,
      });
      const stored = await saveUpload(png, "image/png");
      receipt = (
        await FileModel.create({
          name: `${e.vendor.split(" ")[0]}-${invoiceNumber}.png`,
          mimeType: stored.mimeType,
          size: stored.size,
          storageKey: stored.storageKey,
          checksum: stored.checksum,
          kind: "receipt",
          project: e.project,
          uploadedBy: new Types.ObjectId(admin),
        })
      )._id;
    }
    const doc = await Expense.create({
      number: await nextNumber("expense", undefined, e.date),
      vendor: e.vendor,
      vendorAddress: e.vendorAddress,
      project: e.project,
      stage: e.project ? e.stage : undefined,
      category: e.category,
      description: e.description,
      amount: total,
      date: e.date,
      paymentMethod: e.payment ?? pick(["bank_transfer", "upi", "card", "bank_transfer"] as const),
      gst:
        e.rate > 0
          ? {
              gstin: e.gstin,
              invoiceNumber,
              invoiceDate: e.date,
              taxableAmount: taxable,
              ...tax,
              cess: 0,
              hsnSac: e.hsnSac,
              grandTotal: total,
            }
          : undefined,
      receipt,
      source: "manual",
      createdBy: new Types.ObjectId(pick(people)),
    });
    if (receipt) await FileModel.updateOne({ _id: receipt }, { $set: { entity: { type: "expense", id: doc._id } } });
    expenseCount++;
  };

  // Monthly overheads for the last 12 months.
  for (let m = 11; m >= 0; m--) {
    for (const o of OVERHEAD_VENDORS) {
      if (o.category === "marketing" && m % 2 === 1) continue;
      if (o.category === "professional_fees" && m % 3 !== 0) continue;
      if (o.category === "travel" || o.category === "logistics" || o.category === "office") {
        if (rand() < 0.45) continue;
      }
      const day = Math.min(27, Math.floor(between(1, 26)));
      const date = fromDateInput(toDateInput(addDays(today, -(m * 30 + day))));
      if (date > today) continue;
      const gross = between(o.amount[0], o.amount[1]);
      await addExpense({
        vendor: o.name,
        gstin: o.gstRate > 0 ? gstin("27", panFor(o.name)) : undefined,
        category: o.category,
        amountTaxable: o.gstRate > 0 ? gross / (1 + o.gstRate / 100) : gross,
        rate: o.gstRate,
        date,
        description: o.category === "rent" ? "Office rent" : o.category === "software" ? "Monthly subscription" : undefined,
        hsnSac: o.sac,
        payment: o.category === "rent" ? "bank_transfer" : undefined,
      });
    }
  }

  // Project-specific services and materials.
  const projectSpend: [string, number][] = [["alpha", 9], ["office", 12], ["hub", 8], ["kp", 2], ["demo", 4], ["clinic", 2]];
  for (const [short, count] of projectSpend) {
    const spec = projectSpecs.find((p) => p.short === short)!;
    for (let i = 0; i < count; i++) {
      const s = PROJECT_VENDOR_SPEND[i % PROJECT_VENDOR_SPEND.length]!;
      const startAgo = spec.start;
      const ago = Math.max(1, Math.floor(between(Math.max(0, spec.end > 0 ? spec.end : 0), Math.max(5, startAgo))));
      const outOfState = rand() < 0.15;
      await addExpense({
        vendor: s.vendor ?? "Local vendor",
        vendorAddress: outOfState ? "Bengaluru, Karnataka 560001" : "Pune, Maharashtra 411045",
        gstin: gstin(outOfState ? "29" : "27", panFor(s.vendor ?? "Local vendor", i)),
        interState: outOfState,
        category: s.category,
        amountTaxable: between(s.amount[0], s.amount[1]),
        rate: 18,
        date: daysAgo(ago),
        project: projects[short],
        stage: s.stage,
        description: s.desc,
        hsnSac: s.sac,
        withReceipt: i < 2,
      });
    }
  }
  console.log(`Manual expenses: ${expenseCount}`);

  /* Income */
  const incomeSpecs: [string, string, number, number, IncomeCategory][] = [
    ["alpha", "Sharma Residence", 300000, 150, "advance"],
    ["alpha", "Sharma Residence", 400000, 70, "project_payment"],
    ["alpha", "Sharma Residence", 250000, 12, "project_payment"],
    ["office", "Nexus Tech Park", 750000, 205, "advance"],
    ["office", "Nexus Tech Park", 600000, 120, "project_payment"],
    ["office", "Nexus Tech Park", 600000, 45, "project_payment"],
    ["demo", "Biios Experience Centre", 300000, 235, "project_payment"],
    ["clinic", "Wellness First Clinic", 60000, 55, "advance"],
    ["kp", "Mrs. Anjali Rao", 100000, 6, "advance"],
  ];
  let incomeCount = 0;
  for (const [short, client, amount, ago, category] of incomeSpecs) {
    const date = daysAgo(ago);
    await Income.create({
      number: await nextNumber("income", undefined, date),
      client,
      project: projects[short],
      category,
      amount,
      date,
      paymentMethod: pick(["bank_transfer", "bank_transfer", "cheque", "upi"] as const),
      reference: `UTR${Math.floor(between(100000000, 999999999))}`,
      createdBy: new Types.ObjectId(admin),
    });
    incomeCount++;
  }
  // Smaller product sales and a retainer every month.
  for (let m = 11; m >= 0; m--) {
    const date = daysAgo(m * 30 + Math.floor(between(2, 25)));
    if (date > today) continue;
    await Income.create({
      number: await nextNumber("income", undefined, date),
      client: pick(["Dealer: Smart Living Nashik", "Dealer: HomeTech Mumbai", "Amazon Marketplace", "Retail walk-ins (Baner)"]),
      category: "product_sale",
      amount: round2(between(520000, 880000)),
      date,
      paymentMethod: pick(["upi", "bank_transfer", "card"] as const),
      reference: `ORD-${Math.floor(between(10000, 99999))}`,
      createdBy: new Types.ObjectId(admin),
    });
    if (m % 3 === 0) {
      await Income.create({
        number: await nextNumber("income", undefined, date),
        client: "Nexus Tech Park",
        project: projects.office,
        category: "retainer",
        amount: 45000,
        date: addDays(date, 2) > today ? date : addDays(date, 2),
        paymentMethod: "bank_transfer",
        reference: "Quarterly AMC",
        createdBy: new Types.ObjectId(admin),
      });
      incomeCount++;
    }
    incomeCount++;
  }
  console.log(`Income: ${incomeCount}`);

  await seedPeopleAndSchedules({
    users,
    admin,
    projects: Object.fromEntries(
      projectSpecs.map((p) => [p.short, { id: projects[p.short]!, start: daysAgo(p.start), end: daysAgo(p.end) }]),
    ),
    backfillBills: true,
  });

  /* Tasks */
  const taskSpecs: [string, string | null, TaskPriority, number, TaskStatus][] = [
    ["Finalize switch layout for master bedroom", "alpha", "high", -3, "in_progress"],
    ["Install curtain motors in living room", "alpha", "medium", 4, "pending"],
    ["Customer walkthrough and handover checklist", "alpha", "high", 12, "pending"],
    ["Fix Wi-Fi dropouts on 2nd floor modules", "office", "urgent", -2, "in_progress"],
    ["Commission occupancy sensors, floor 7", "office", "high", 6, "review"],
    ["Energy dashboard: weekly report email", "office", "medium", 15, "pending"],
    ["Order additional copper wire", "office", "high", -5, "pending"],
    ["Firmware OTA test on 30 nodes", "hub", "high", 2, "in_progress"],
    ["Matter certification paperwork", "hub", "medium", 25, "pending"],
    ["Enclosure v3 drawing review", "hub", "medium", -1, "review"],
    ["Thermal test report for mainboard", "hub", "low", 9, "pending"],
    ["Site survey for penthouse", "kp", "medium", 3, "pending"],
    ["Prepare quotation for Koregaon Park", "kp", "high", 1, "in_progress"],
    ["Demo wall photo shoot", "demo", "low", -40, "completed"],
    ["Replace faulty relay on demo wall", "demo", "medium", -20, "completed"],
    ["Confirm interior timeline with clinic", "clinic", "low", 20, "pending"],
    ["Quarterly GST filing data for CA", null, "high", 5, "pending"],
    ["Renew Google Workspace licences", null, "low", -12, "cancelled"],
    ["Purchase aluminium sheets (out of stock)", null, "urgent", 0, "pending"],
    ["Update inventory minimum levels", null, "medium", -8, "completed"],
    ["Hire one more field electrician", null, "medium", 30, "pending"],
    ["Write installation SOP v2", null, "low", 18, "in_progress"],
  ];
  let order = 1000;
  for (const [title, short, priority, dueIn, status] of taskSpecs) {
    const assignee = pick(people);
    const created = addDays(today, -Math.floor(between(5, 40)));
    await Task.create({
      number: await nextNumber("task"),
      title,
      description: `${title}. Keep the client informed and log the time spent.`,
      project: short ? projects[short] : undefined,
      assignee: new Types.ObjectId(assignee),
      priority,
      dueDate: addDays(today, dueIn),
      status,
      order: (order += 1000),
      completedAt: status === "completed" ? addDays(today, dueIn - 1) : undefined,
      comments:
        rand() < 0.5
          ? [
              { author: new Types.ObjectId(pick(people)), body: "Checked with the site team, materials are ready.", createdAt: addDays(created, 1), updatedAt: addDays(created, 1) },
              { author: new Types.ObjectId(pick(people)), body: "Updated the plan, see the latest drawing.", createdAt: addDays(created, 2), updatedAt: addDays(created, 2) },
            ]
          : [],
      createdBy: new Types.ObjectId(admin),
      createdAt: created,
    });
  }
  console.log(`Tasks: ${taskSpecs.length}`);
  console.log(`Done. Sign in as ${ADMIN_EMAIL} (or any teammate) with password ${PASSWORD}`);
}

main()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
