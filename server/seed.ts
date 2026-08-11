import { db } from "./db";
import { clients, jobs, invoices, lineItems, payments, employees, timeEntries, employeeAssignments, payrollRecords, onboardingItems, employeeDeductions, changeOrders, smsAttempts, settings } from "@shared/schema";
import { sql } from "drizzle-orm";
import { log } from "./logger";

export async function seedDemoData({ force = false }: { force?: boolean } = {}) {
  const existing = await db.select({ id: clients.id }).from(clients).limit(1);
  if (existing.length > 0 && !force) return;

  if (force) {
    log("Force-reseeding demo data — clearing existing records…", "seed");
    await db.execute(sql`
      TRUNCATE TABLE
        sms_attempts, onboarding_items, employee_deductions, employee_assignments,
        time_entries, payroll_records, reminder_logs, change_orders,
        payments, line_items, invoices, jobs, bank_accounts,
        clients, employees, settings
      RESTART IDENTITY CASCADE
    `);
  }

  log("Seeding demo data…", "seed");

  // ── Clients ───────────────────────────────────────────────────────────────
  await db.execute(sql`
    INSERT INTO clients (id, name, general_contractor_name, email, phone, address, city, state, zip_code, notes) VALUES
      ('c1000', 'Margaret Holt',          NULL,           'margaret.holt@gmail.com',        '07700 900142', '14 Elmwood Close',       'Bristol',    'England', 'BS6 6AJ', 'Prefers morning visits. Has a listed building — check restrictions before sanding.'),
      ('c1001', 'Riverside Build Co.',    'Tom Ashby',    'contracts@riversidebuild.co.uk', '020 7946 0311','32 Canal Wharf',          'London',     'England', 'E14 4QE', 'GC contact is Tom Ashby. Invoices need PO number on header.'),
      ('c1002', 'Daniel & Priya Okonkwo', NULL,           'dokonkwo@outlook.com',           '07911 654321', '8 Birchwood Avenue',      'Manchester', 'England', 'M21 9WR', 'New extension + full repaint. Very particular about colour matching.'),
      ('c1003', 'Meridian Property',      'Sarah Chen',   'sarah.chen@meridianprop.com',    '0161 496 0055','One Meridian Square',     'Leeds',      'England', 'LS1 4AP', 'Facilities manager is Sarah Chen. Access via loading bay after 8 am.'),
      ('c1004', 'Whitmore Hotel',          NULL,           'ops@whitmore-hotel.co.uk',       '01225 900700', '2-4 Royal Crescent Lane', 'Bath',       'England', 'BA1 2LS', 'Grade II listed. All paint must be Farrow & Ball period palette. Work only Sun-Mon.')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Jobs ──────────────────────────────────────────────────────────────────
  await db.execute(sql`
    INSERT INTO jobs (id, client_id, title, description, address, status, square_footage, start_date, end_date, estimated_total, reference_codes) VALUES
      ('j1','c1000','Full Interior Repaint',
        'Full repaint of all rooms including ceilings. Two coats Farrow & Ball estate emulsion throughout.',
        '14 Elmwood Close, Bristol BS6 6AJ','in_progress','1850','2026-06-10','2026-07-04','6200.00',
        '[{"label":"Colour","code":"No.9 Elephant Breath"}]'),
      ('j2','c1001','Commercial Office Fit-Out — Level 3',
        'Skim and paint 3rd floor open-plan office, feature wall, and reception. Fire-rated paint required in stairwell.',
        '32 Canal Wharf, London E14 4QE','completed','4200','2026-05-05','2026-05-30','14800.00',
        '[{"label":"PO","code":"RBC-2026-044"},{"label":"Spec","code":"BS476-Pt22"}]'),
      ('j3','c1001','Stairwell Fire-Rated Repaint',
        'Strip and repaint all stairwells floors 1-6 with Nullifire intumescent coating.',
        '32 Canal Wharf, London E14 4QE','quoted','980',NULL,NULL,'4100.00',
        '[{"label":"PO","code":"RBC-2026-071"}]'),
      ('j4','c1002','Extension & Full House Repaint',
        'New rear extension (plaster prep + prime + 2 coats), full interior repaint of existing 4-bed house.',
        '8 Birchwood Avenue, Manchester M21 9WR','scheduled','2600','2026-07-14','2026-08-08','9400.00',
        '[{"label":"Colour A","code":"Dulux Chic Shadow"},{"label":"Colour B","code":"Dulux White Mist"}]'),
      ('j5','c1003','Meridian HQ — Common Areas',
        'Redecorate ground-floor lobby, 2 lift lobbies, and 4 meeting rooms. VOC-free paint throughout.',
        'One Meridian Square, Leeds LS1 4AP','completed','3100','2026-04-07','2026-04-25','11200.00',
        '[{"label":"Spec ref","code":"MER-DEC-2026-A"},{"label":"PO","code":"PO-88421"}]'),
      ('j6','c1004','Grand Suite Corridor Restoration',
        'Strip wallpaper, repair plasterwork, and apply Farrow & Ball period finish to Floors 1-3 corridors.',
        '2-4 Royal Crescent Lane, Bath BA1 2LS','in_progress','1420','2026-06-22','2026-07-18','7800.00',
        '[{"label":"Colour","code":"No.42 Elephants Breath"},{"label":"Heritage ref","code":"NHLE-1234567"}]')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Invoices ──────────────────────────────────────────────────────────────
  await db.execute(sql`
    INSERT INTO invoices (id, invoice_number, client_id, job_id, status, subtotal, tax_rate, tax_amount, total, amount_paid, balance, issue_date, due_date, notes) VALUES
      ('i1','INV-2026-001','c1000','j1','sent',    '3100.00','20','620.00', '3720.00','0.00',     '3720.00','2026-06-12','2026-06-26','Deposit invoice — 50% of total before works begin.'),
      ('i2','INV-2026-002','c1001','j2','paid',    '8400.00','20','1680.00','10080.00','10080.00','0.00',   '2026-05-06','2026-05-20','Stage 1 payment — office fit-out completion.'),
      ('i3','INV-2026-003','c1001','j2','paid',    '6400.00','20','1280.00','7680.00','7680.00',  '0.00',  '2026-06-01','2026-06-15','Stage 2 — final balance including snagging.'),
      ('i4','INV-2026-004','c1002','j4','draft',   '4700.00','20','940.00', '5640.00','0.00',     '5640.00','2026-06-28','2026-07-12','Deposit for extension and full repaint works.'),
      ('i5','INV-2026-005','c1003','j5','overdue', '11200.00','20','2240.00','13440.00','6720.00','6720.00','2026-04-26','2026-05-10','Final invoice — balance outstanding. Partial payment received 14 May.'),
      ('i6','INV-2026-006','c1004','j6','sent',    '3900.00','20','780.00', '4680.00','0.00',     '4680.00','2026-06-23','2026-07-07','Progress invoice — corridors floors 1 & 2 complete.'),
      ('i7','INV-2026-007','c1001','j3','draft',   '4100.00','20','820.00', '4920.00','0.00',     '4920.00','2026-06-30','2026-07-14','Quote accepted. Awaiting PO confirmation before sending.')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Line items ────────────────────────────────────────────────────────────
  await db.execute(sql`
    INSERT INTO line_items (id, job_id, invoice_id, category, description, quantity, unit, rate, amount, section) VALUES
      ('li01','j1','i1','labor',        'Prep & masking — all rooms',             '16','hours','35.00','560.00',  'Preparation'),
      ('li02','j1','i1','materials',    'Farrow & Ball Estate Emulsion 5L x 8',   '8', 'each', '52.00','416.00',  'Materials'),
      ('li03','j1','i1','square_footage','Ceiling painting — all rooms',          '1850','sqft','0.80','1480.00', 'Ceilings'),
      ('li04','j1','i1','labor',        'First coat — walls, all rooms',          '18','hours','35.00','630.00',  'Walls'),
      ('li05','j1','i1','other',        'Scaffold hire — stairwell',              '1', 'each', '14.00','14.00',   'Other'),
      ('li06','j2','i2','labor',        'Skim + sand 3rd floor open plan',        '24','hours','38.00','912.00',  'Prep'),
      ('li07','j2','i2','materials',    'Dulux Trade vinyl matt — 10L x 12',      '12','each', '48.00','576.00',  'Materials'),
      ('li08','j2','i2','square_footage','Wall painting — open plan',             '3200','sqft','1.20','3840.00', 'Walls'),
      ('li09','j2','i2','labor',        'Feature wall — 2-colour geometric',      '14','hours','45.00','630.00',  'Feature'),
      ('li10','j2','i2','other',        'Cherry picker hire — 2 days',            '2', 'days', '221.00','442.00', 'Equipment'),
      ('li11','j2','i3','labor',        'Reception area full repaint',            '20','hours','38.00','760.00',  'Reception'),
      ('li12','j2','i3','materials',    'Nullifire S607 intumescent 5L x 4',      '4', 'each', '148.00','592.00', 'Fire-rated'),
      ('li13','j2','i3','square_footage','Stairwell — fire-rated coat',           '980','sqft', '1.85','1813.00', 'Stairwell'),
      ('li14','j2','i3','labor',        'Snagging & touch-ups',                   '8', 'hours','38.00','304.00',  'Snagging'),
      ('li15','j2','i3','other',        'Waste disposal',                         '1', 'each', '45.00','45.00',   'Other'),
      ('li16','j4','i4','labor',        'New extension — plaster prime coat',     '12','hours','36.00','432.00',  'Extension'),
      ('li17','j4','i4','materials',    'Dulux Chic Shadow 2.5L x 6',             '6', 'each', '32.00','192.00',  'Materials'),
      ('li18','j4','i4','square_footage','Extension walls & ceiling',             '720','sqft', '1.05','756.00',  'Extension'),
      ('li19','j4','i4','labor',        'Existing house strip & prep',            '22','hours','36.00','792.00',  'Main House'),
      ('li20','j4','i4','other',        'Colour match fee — Dulux Colour Match',  '1', 'each', '38.00','38.00',   'Other'),
      ('li21','j5','i5','labor',        'Lobby strip, fill & prime',              '20','hours','40.00','800.00',  'Lobby'),
      ('li22','j5','i5','materials',    'Zinsser BIN primer 1L x 4',              '4', 'each', '28.00','112.00',  'Materials'),
      ('li23','j5','i5','square_footage','Lobby walls floor-to-ceiling',          '1200','sqft','1.40','1680.00', 'Lobby'),
      ('li24','j5','i5','labor',        'Meeting rooms x 4 — full repaint',       '32','hours','40.00','1280.00', 'Meeting Rooms'),
      ('li25','j5','i5','square_footage','Meeting rooms walls',                   '1400','sqft','1.10','1540.00', 'Meeting Rooms'),
      ('li26','j5','i5','labor',        'Lift lobby x 2 — repaint & borders',    '18','hours','40.00','720.00',  'Lift Lobbies'),
      ('li27','j5','i5','square_footage','Lift lobby walls',                      '500', 'sqft','1.25','625.00',  'Lift Lobbies'),
      ('li28','j5','i5','other',        'VOC testing certificate',                '1', 'each', '85.00','85.00',   'Compliance'),
      ('li29','j6','i6','labor',        'Strip wallpaper — floors 1 & 2',         '24','hours','42.00','1008.00', 'Strip'),
      ('li30','j6','i6','materials',    'Farrow & Ball No.42 5L x 6',             '6', 'each', '58.00','348.00',  'Materials'),
      ('li31','j6','i6','square_footage','Corridor walls — floors 1 & 2',         '960','sqft', '1.65','1584.00', 'Corridors'),
      ('li32','j6','i6','other',        'Listed building heritage survey report',  '1', 'each', '210.00','210.00','Compliance'),
      ('li33','j6','i6','labor',        'Plasterwork repairs — 6 areas',           '9','hours', '42.00','378.00',  'Repairs'),
      ('li34','j6','i6','other',        'Heritage lime-putty render 25kg x 2',    '2', 'each', '186.00','372.00', 'Materials'),
      ('li35','j3','i7','labor',        'Strip & prepare stairwells — floors 1-6','40','hours','38.00','1520.00', 'Prep'),
      ('li36','j3','i7','materials',    'Nullifire S607 intumescent 5L x 8',      '8', 'each', '148.00','1184.00','Fire-rated'),
      ('li37','j3','i7','square_footage','Stairwell fire-rated coat — all floors', '980','sqft','1.42','1391.60', 'Application'),
      ('li38','j3','i7','other',        'Inspection & certificate (BAFE)',         '1', 'each', '4.40','4.40',    'Compliance')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Change orders ─────────────────────────────────────────────────────────
  await db.execute(sql`
    INSERT INTO change_orders (id, invoice_id, description, amount, reason, status) VALUES
      ('co1','i1','Additional coat required on hallway ceiling due to water stain bleed-through','285.00','Unforeseen condition discovered on site','approved'),
      ('co2','i6','Extra plasterwork repairs found behind wallpaper on floor 3 corridor',        '420.00','Hidden damage not visible at quote stage','pending'),
      ('co3','i5','Upgrade to antimicrobial paint in all meeting rooms per client request',      '340.00','Client-requested scope change','approved')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Payments ──────────────────────────────────────────────────────────────
  await db.execute(sql`
    INSERT INTO payments (id, invoice_id, amount, payment_method, payment_date, reference_number, notes) VALUES
      ('p1','i2','10080.00','bank_transfer','2026-05-21','BAC-00412','Full payment — Riverside Build office fit-out stage 1.'),
      ('p2','i3','7680.00', 'bank_transfer','2026-06-16','BAC-00438','Full payment — Riverside Build office fit-out stage 2.'),
      ('p3','i5','6720.00', 'check',        '2026-05-14','CHQ-88712','Partial payment received. Chasing balance by end of May.')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Employees ─────────────────────────────────────────────────────────────
  await db.execute(sql`
    INSERT INTO employees (id, name, email, phone, day_rate, position, hire_date, status, employment_type, pay_type) VALUES
      ('e1','Jamie Holbrook', 'jamie@jobsoxo.local',  '07700 111222','36.00','Senior Decorator',   '2021-03-15','active','employee','daily'),
      ('e2','Cora Ndiaye',    'cora@jobsoxo.local',   '07700 333444','34.00','Decorator',          '2022-08-01','active','employee','daily'),
      ('e3','Reuben Marsh',   'reuben@jobsoxo.local', '07700 555666','32.00','Decorator',          '2023-01-10','active','employee','daily'),
      ('e4','Leila Osei',     'leila@jobsoxo.local',  '07700 777888','28.00','Apprentice Painter', '2025-09-01','active','employee','daily'),
      ('e5','Patrick Dolan',  'patrick@jobsoxo.local','07700 999000','40.00','Contracts Manager',  '2019-06-20','active','employee','daily')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Employee assignments ──────────────────────────────────────────────────
  await db.execute(sql`
    INSERT INTO employee_assignments (id, employee_id, job_id, assigned_date) VALUES
      ('ea01','e1','j1','2026-06-10'),
      ('ea02','e2','j1','2026-06-10'),
      ('ea03','e3','j1','2026-06-12'),
      ('ea04','e1','j2','2026-05-05'),
      ('ea05','e2','j2','2026-05-05'),
      ('ea06','e5','j2','2026-05-05'),
      ('ea07','e1','j6','2026-06-22'),
      ('ea08','e3','j6','2026-06-22'),
      ('ea09','e4','j6','2026-06-24'),
      ('ea10','e2','j5','2026-04-07'),
      ('ea11','e3','j5','2026-04-07'),
      ('ea12','e5','j4','2026-07-14')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Time entries ──────────────────────────────────────────────────────────
  await db.execute(sql`
    INSERT INTO time_entries (id, employee_id, job_id, date, hours_worked, description, source) VALUES
      -- Jamie on j1 (Bristol repaint, Jun)
      ('te01','e1','j1','2026-06-10','8','Prep work — masking, filling, sanding all rooms','manual'),
      ('te02','e1','j1','2026-06-11','8','Prime coat — hallway and living room','manual'),
      ('te03','e1','j1','2026-06-12','7.5','First coat — bedrooms 1 and 2','manual'),
      ('te04','e1','j1','2026-06-13','8','First coat — bedroom 3, bathroom, kitchen','manual'),
      ('te05','e1','j1','2026-06-16','8','Second coat — hallway and living room','manual'),
      ('te06','e1','j1','2026-06-17','8','Second coat — bedrooms','manual'),
      ('te07','e1','j1','2026-06-18','6','Ceilings — all rooms','manual'),
      -- Cora on j1
      ('te08','e2','j1','2026-06-10','8','Masking and preparation — upper floor','manual'),
      ('te09','e2','j1','2026-06-11','8','First coat — landing and stairwell','manual'),
      ('te10','e2','j1','2026-06-12','8','Ceilings — upper floor','manual'),
      ('te11','e2','j1','2026-06-13','7','First coat — kitchen and utility','manual'),
      -- Reuben on j1
      ('te12','e3','j1','2026-06-12','8','Gloss work — skirting and doors throughout','manual'),
      ('te13','e3','j1','2026-06-13','8','Gloss second coat — doors and frames','manual'),
      -- Jamie on j2 (London office)
      ('te14','e1','j2','2026-05-05','8','Site setup, skim prep — open plan','manual'),
      ('te15','e1','j2','2026-05-06','8','Skim + sand — east half of floor','manual'),
      ('te16','e1','j2','2026-05-07','8','Skim + sand — west half, reception','manual'),
      ('te17','e1','j2','2026-05-08','8','First coat — open plan walls','manual'),
      ('te18','e1','j2','2026-05-09','7','Feature wall — first stage geometry layout','manual'),
      ('te19','e1','j2','2026-05-12','8','Feature wall — second colour, clean edges','manual'),
      ('te20','e1','j2','2026-05-13','8','Second coat — all walls','manual'),
      -- Cora on j2
      ('te21','e2','j2','2026-05-05','8','Reception prep — strip and fill','manual'),
      ('te22','e2','j2','2026-05-06','8','Reception paint — first coat','manual'),
      ('te23','e2','j2','2026-05-19','8','Snagging — touch-ups across floor','manual'),
      ('te24','e2','j2','2026-05-20','6','Stairwell fire-rated coat — floors 1-2','manual'),
      -- Cora on j5 (Leeds)
      ('te25','e2','j5','2026-04-07','8','Lobby prep — strip, fill, prime','manual'),
      ('te26','e2','j5','2026-04-08','8','Lobby first coat — walls','manual'),
      ('te27','e2','j5','2026-04-09','8','Lobby second coat','manual'),
      ('te28','e2','j5','2026-04-10','8','Meeting rooms 1-2 — full repaint','manual'),
      ('te29','e2','j5','2026-04-11','8','Meeting rooms 3-4 — full repaint','manual'),
      -- Reuben on j5
      ('te30','e3','j5','2026-04-07','8','Lift lobby 1 — strip and first coat','manual'),
      ('te31','e3','j5','2026-04-08','8','Lift lobby 2 — strip and first coat','manual'),
      ('te32','e3','j5','2026-04-09','8','Lift lobbies second coat','manual'),
      ('te33','e3','j5','2026-04-10','8','Borders and detail work — both lift lobbies','manual'),
      -- Jamie on j6 (Bath hotel)
      ('te34','e1','j6','2026-06-22','8','Strip wallpaper — floor 1 corridor','manual'),
      ('te35','e1','j6','2026-06-23','8','Strip wallpaper — floor 2 corridor','manual'),
      ('te36','e1','j6','2026-06-24','8','Plaster repairs — 6 areas, floor 1','manual'),
      ('te37','e1','j6','2026-06-25','7','Prime coat — floor 1 corridor','manual'),
      ('te38','e1','j6','2026-06-30','8','Farrow & Ball first coat — floor 1','manual'),
      -- Reuben on j6
      ('te39','e3','j6','2026-06-22','8','Strip wallpaper — floor 3 corridor','manual'),
      ('te40','e3','j6','2026-06-23','8','Plaster repairs — floor 3','manual'),
      ('te41','e3','j6','2026-06-24','8','Prime and first coat — floor 3','manual'),
      -- Leila on j6
      ('te42','e4','j6','2026-06-24','8','Prep assistance — masking and filling','manual'),
      ('te43','e4','j6','2026-06-25','8','Paint cutting-in — floor 2','manual'),
      ('te44','e4','j6','2026-06-30','7','Second coat assistance — floor 2','manual')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Payroll records ───────────────────────────────────────────────────────
  await db.execute(sql`
    INSERT INTO payroll_records (id, employee_id, period_start, period_end, total_hours, regular_hours, overtime_hours, day_rate, regular_pay, overtime_pay, gross_pay, tax_withheld, deductions, net_pay, status, paid_date) VALUES
      ('pr01','e1','2026-05-01','2026-05-14','80','80','0','36.00','2880.00','0.00','2880.00','576.00','0.00','2304.00','paid','2026-05-16'),
      ('pr02','e2','2026-05-01','2026-05-14','72','72','0','34.00','2448.00','0.00','2448.00','489.60','0.00','1958.40','paid','2026-05-16'),
      ('pr03','e3','2026-05-01','2026-05-14','64','64','0','32.00','2048.00','0.00','2048.00','409.60','0.00','1638.40','paid','2026-05-16'),
      ('pr04','e4','2026-05-01','2026-05-14','40','40','0','28.00','1120.00','0.00','1120.00','224.00','0.00','896.00','paid', '2026-05-16'),
      ('pr05','e5','2026-05-01','2026-05-14','80','80','0','40.00','3200.00','0.00','3200.00','640.00','0.00','2560.00','paid','2026-05-16'),
      ('pr06','e1','2026-05-15','2026-05-28','80','80','0','36.00','2880.00','0.00','2880.00','576.00','0.00','2304.00','paid','2026-05-30'),
      ('pr07','e2','2026-05-15','2026-05-28','76','76','0','34.00','2584.00','0.00','2584.00','516.80','0.00','2067.20','paid','2026-05-30'),
      ('pr08','e3','2026-05-15','2026-05-28','64','64','0','32.00','2048.00','0.00','2048.00','409.60','0.00','1638.40','paid','2026-05-30'),
      ('pr09','e1','2026-06-01','2026-06-14','84','80','4','36.00','2880.00','216.00','3096.00','619.20','0.00','2476.80','paid','2026-06-16'),
      ('pr10','e2','2026-06-01','2026-06-14','72','72','0','34.00','2448.00','0.00','2448.00','489.60','0.00','1958.40','paid','2026-06-16'),
      ('pr11','e3','2026-06-01','2026-06-14','72','72','0','32.00','2304.00','0.00','2304.00','460.80','0.00','1843.20','paid','2026-06-16'),
      ('pr12','e4','2026-06-01','2026-06-14','56','56','0','28.00','1568.00','0.00','1568.00','313.60','0.00','1254.40','paid','2026-06-16'),
      ('pr13','e1','2026-06-15','2026-06-28','80','80','0','36.00','2880.00','0.00','2880.00','576.00','0.00','2304.00','paid','2026-06-30'),
      ('pr14','e2','2026-06-15','2026-06-28','72','72','0','34.00','2448.00','0.00','2448.00','489.60','0.00','1958.40','paid','2026-06-30'),
      ('pr15','e3','2026-06-15','2026-06-28','80','80','0','32.00','2560.00','0.00','2560.00','512.00','0.00','2048.00','paid','2026-06-30'),
      ('pr16','e4','2026-06-15','2026-06-28','64','64','0','28.00','1792.00','0.00','1792.00','358.40','0.00','1433.60','paid','2026-06-30'),
      ('pr17','e5','2026-06-15','2026-06-28','80','80','0','40.00','3200.00','0.00','3200.00','640.00','0.00','2560.00','paid','2026-06-30')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Employee deductions ───────────────────────────────────────────────────
  await db.execute(sql`
    INSERT INTO employee_deductions (id, employee_id, label, deduction_type, amount, category, active) VALUES
      ('ed01','e1','Union dues',          'fixed',      '12.50','union',    true),
      ('ed02','e1','Tool scheme',         'fixed',      '8.00', 'equipment',true),
      ('ed03','e2','Union dues',          'fixed',      '12.50','union',    true),
      ('ed04','e3','Pension top-up',      'percentage', '2.00', 'pension',  true),
      ('ed05','e4','Apprenticeship levy', 'fixed',      '5.00', 'other',    true),
      ('ed06','e5','Union dues',          'fixed',      '12.50','union',    true),
      ('ed07','e5','Private health',      'fixed',      '45.00','health',   true)
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Onboarding items ──────────────────────────────────────────────────────
  await db.execute(sql`
    INSERT INTO onboarding_items (id, employee_id, label, completed, completed_date, sort_order) VALUES
      -- Jamie (all done)
      ('oi01','e1','Right to work check',         true, '2021-03-15', 1),
      ('oi02','e1','CSCS card verified',           true, '2021-03-15', 2),
      ('oi03','e1','Contract signed',              true, '2021-03-16', 3),
      ('oi04','e1','Health & safety induction',    true, '2021-03-16', 4),
      ('oi05','e1','Bank account connected',       true, '2021-03-17', 5),
      -- Cora (all done)
      ('oi06','e2','Right to work check',          true, '2022-08-01', 1),
      ('oi07','e2','CSCS card verified',           true, '2022-08-01', 2),
      ('oi08','e2','Contract signed',              true, '2022-08-02', 3),
      ('oi09','e2','Health & safety induction',    true, '2022-08-02', 4),
      ('oi10','e2','Bank account connected',       true, '2022-08-03', 5),
      -- Reuben (mostly done)
      ('oi11','e3','Right to work check',          true, '2023-01-10', 1),
      ('oi12','e3','CSCS card verified',           true, '2023-01-10', 2),
      ('oi13','e3','Contract signed',              true, '2023-01-11', 3),
      ('oi14','e3','Health & safety induction',    true, '2023-01-11', 4),
      ('oi15','e3','Bank account connected',       false, NULL,        5),
      -- Leila (newer hire, some outstanding)
      ('oi16','e4','Right to work check',          true, '2025-09-01', 1),
      ('oi17','e4','CSCS card verified',           true, '2025-09-02', 2),
      ('oi18','e4','Contract signed',              true, '2025-09-01', 3),
      ('oi19','e4','Health & safety induction',    false, NULL,        4),
      ('oi20','e4','Bank account connected',       false, NULL,        5),
      ('oi21','e4','PPE kit issued',               false, NULL,        6),
      -- Patrick (all done)
      ('oi22','e5','Right to work check',          true, '2019-06-20', 1),
      ('oi23','e5','Contract signed',              true, '2019-06-21', 3),
      ('oi24','e5','Health & safety induction',    true, '2019-06-21', 4),
      ('oi25','e5','Bank account connected',       true, '2019-06-22', 5),
      ('oi26','e5','Company vehicle policy signed',true, '2019-06-24', 6)
    ON CONFLICT (id) DO NOTHING
  `);

  // ── SMS attempts ──────────────────────────────────────────────────────────
  await db.execute(sql`
    INSERT INTO sms_attempts (id, from_phone, body, status, employee_id, employee_name, hours_requested, reply_message) VALUES
      ('sa01','+447700111222','LOG 8 Bristol job prep',                     'success','e1','Jamie Holbrook','8',  'Logged 8h for Jamie Holbrook on 2026-06-10. Total today: 8h.'),
      ('sa02','+447700333444','LOG 8 office skim prep',                     'success','e2','Cora Ndiaye',   '8',  'Logged 8h for Cora Ndiaye on 2026-05-05. Total today: 8h.'),
      ('sa03','+447700555666','LOG 25 gloss work today',                    'rejected',NULL,NULL,           '25', 'Cannot log 25h — exceeds 24-hour daily limit. Please check and re-send.'),
      ('sa04','+447700777888','LOG 8 Bath hotel corridor',                  'success','e4','Leila Osei',    '8',  'Logged 8h for Leila Osei on 2026-06-24. Total today: 8h.'),
      ('sa05','+447700111222','LOG 7.5 bedrooms first coat',                'success','e1','Jamie Holbrook','7.5','Logged 7.5h for Jamie Holbrook on 2026-06-12. Total today: 7.5h.'),
      ('sa06','+447799000000','LOG 6 random number',                        'rejected',NULL,NULL,           '6',  'Your number is not linked to an employee account. Contact your manager.'),
      ('sa07','+447700333444','STATUS',                                     'success','e2','Cora Ndiaye',   NULL, 'Hi Cora — you are assigned to: Bristol Repaint (j1), Leeds HQ (j5).'),
      ('sa08','+447700555666','LOG 8 Bath hotel floor 3 strip',             'success','e3','Reuben Marsh',  '8',  'Logged 8h for Reuben Marsh on 2026-06-22. Total today: 8h.')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── App settings ──────────────────────────────────────────────────────────
  await db.execute(sql`
    INSERT INTO settings (id, company_name, company_email, company_phone, company_address, tax_rate, invoice_prefix, invoice_terms, reminder_intervals, inbox_sync_hour, collections_enabled)
    VALUES (
      'settings-1',
      'Oxo Decorating Ltd',
      'admin@jobsoxo.local',
      '0117 496 0200',
      '18 Paintworks, Bristol BS4 3EH',
      '20',
      'INV',
      'Payment due within 14 days of invoice date. Bank transfer preferred. Late payments subject to 8% statutory interest.',
      '[7, 14, 21]',
      9,
      true
    )
    ON CONFLICT (id) DO NOTHING
  `);

  log("Demo data seeded — 5 clients, 6 jobs, 7 invoices, 38 line items, 3 change orders, 3 payments, 5 employees, 44 time entries, 17 payroll records, 7 deductions, 26 onboarding items, 8 SMS attempts", "seed");
}
