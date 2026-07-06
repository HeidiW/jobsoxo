import { db } from "./db";
import { clients, jobs, invoices, lineItems, payments, employees } from "@shared/schema";
import { sql } from "drizzle-orm";
import { log } from "./index";

export async function seedDemoData() {
  const existing = await db.select({ id: clients.id }).from(clients).limit(1);
  if (existing.length > 0) return;

  log("Empty database detected — seeding demo data…", "seed");

  await db.execute(sql`
    INSERT INTO clients (id, name, general_contractor_name, email, phone, address, city, state, zip_code, notes) VALUES
      ('c1000', 'Margaret Holt',        NULL,                         'margaret.holt@gmail.com',        '07700 900142', '14 Elmwood Close',       'Bristol',    'England', 'BS6 6AJ', 'Prefers morning visits. Has a listed building — check restrictions before sanding.'),
      ('c1001', 'Riverside Build Co.',  'Tom Ashby',                  'contracts@riversidebuild.co.uk', '020 7946 0311','32 Canal Wharf',          'London',     'England', 'E14 4QE', 'GC contact is Tom Ashby. Invoices need PO number on header.'),
      ('c1002', 'Daniel & Priya Okonkwo', NULL,                       'dokonkwo@outlook.com',           '07911 654321', '8 Birchwood Avenue',      'Manchester', 'England', 'M21 9WR', 'New extension + full repaint. Very particular about colour matching.'),
      ('c1003', 'Meridian Property',    'Sarah Chen',                 'sarah.chen@meridianprop.com',    '0161 496 0055','One Meridian Square',     'Leeds',      'England', 'LS1 4AP', 'Facilities manager is Sarah Chen. Access via loading bay after 8 am.'),
      ('c1004', 'Whitmore Hotel',       NULL,                         'ops@whitmore-hotel.co.uk',       '01225 900700', '2-4 Royal Crescent Lane', 'Bath',       'England', 'BA1 2LS', 'Grade II listed. All paint must be Farrow & Ball period palette. Work only Sun-Mon.')
    ON CONFLICT (id) DO NOTHING
  `);

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

  await db.execute(sql`
    INSERT INTO invoices (id, invoice_number, client_id, job_id, status, subtotal, tax_rate, tax_amount, total, amount_paid, balance, issue_date, due_date, notes) VALUES
      ('i1','INV-2026-001','c1000','j1','sent',   '3100.00','20','620.00', '3720.00','0.00',    '3720.00','2026-06-12','2026-06-26','Deposit invoice — 50% of total before works begin.'),
      ('i2','INV-2026-002','c1001','j2','paid',   '8400.00','20','1680.00','10080.00','10080.00','0.00',  '2026-05-06','2026-05-20','Stage 1 payment — office fit-out completion.'),
      ('i3','INV-2026-003','c1001','j2','paid',   '6400.00','20','1280.00','7680.00','7680.00', '0.00',  '2026-06-01','2026-06-15','Stage 2 — final balance including snagging.'),
      ('i4','INV-2026-004','c1002','j4','draft',  '4700.00','20','940.00', '5640.00','0.00',    '5640.00','2026-06-28','2026-07-12','Deposit for extension and full repaint works.'),
      ('i5','INV-2026-005','c1003','j5','overdue','11200.00','20','2240.00','13440.00','6720.00','6720.00','2026-04-26','2026-05-10','Final invoice — balance outstanding. Partial payment received 14 May.'),
      ('i6','INV-2026-006','c1004','j6','sent',   '3900.00','20','780.00', '4680.00','0.00',    '4680.00','2026-06-23','2026-07-07','Progress invoice — corridors floors 1 & 2 complete.'),
      ('i7','INV-2026-007','c1001','j3','draft',  '4100.00','20','820.00', '4920.00','0.00',    '4920.00','2026-06-30','2026-07-14','Quote accepted. Awaiting PO confirmation before sending.')
    ON CONFLICT (id) DO NOTHING
  `);

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

  await db.execute(sql`
    INSERT INTO payments (id, invoice_id, amount, payment_method, payment_date, reference_number, notes) VALUES
      ('p1','i2','10080.00','bank_transfer','2026-05-21','BAC-00412','Full payment — Riverside Build office fit-out stage 1.'),
      ('p2','i3','7680.00', 'bank_transfer','2026-06-16','BAC-00438','Full payment — Riverside Build office fit-out stage 2.'),
      ('p3','i5','6720.00', 'check',        '2026-05-14','CHQ-88712','Partial payment received. Chasing balance by end of May.')
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO employees (id, name, email, phone, day_rate, position, hire_date, status) VALUES
      ('e1','Jamie Holbrook', 'jamie@jobsoxo.local',  '07700 111222','36.00','Senior Decorator',   '2021-03-15','active'),
      ('e2','Cora Ndiaye',    'cora@jobsoxo.local',   '07700 333444','34.00','Decorator',          '2022-08-01','active'),
      ('e3','Reuben Marsh',   'reuben@jobsoxo.local', '07700 555666','32.00','Decorator',          '2023-01-10','active'),
      ('e4','Leila Osei',     'leila@jobsoxo.local',  '07700 777888','28.00','Apprentice Painter', '2025-09-01','active'),
      ('e5','Patrick Dolan',  'patrick@jobsoxo.local','07700 999000','40.00','Contracts Manager',  '2019-06-20','active')
    ON CONFLICT (id) DO NOTHING
  `);

  log("Demo data seeded — 5 clients, 6 jobs, 7 invoices, 38 line items, 3 payments, 5 employees", "seed");
}
