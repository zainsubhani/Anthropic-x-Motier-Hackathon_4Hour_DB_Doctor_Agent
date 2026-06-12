import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');

console.log('Creating tables...');

db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    category TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    total REAL NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
    -- NOTE: Deliberately no index on customer_id — this is the demo "bug"
  );
`);

const customerCount = (db.prepare('SELECT COUNT(*) as n FROM customers').get() as { n: number }).n;
if (customerCount === 0) {
  console.log('Seeding customers...');
  const insertCustomer = db.prepare(
    'INSERT INTO customers (name, email, created_at) VALUES (?, ?, ?)'
  );
  const insertMany = db.transaction(() => {
    for (let i = 1; i <= 500; i++) {
      insertCustomer.run(`Customer ${i}`, `customer${i}@example.com`, new Date().toISOString());
    }
  });
  insertMany();
}

const productCount = (db.prepare('SELECT COUNT(*) as n FROM products').get() as { n: number }).n;
if (productCount === 0) {
  console.log('Seeding products...');
  const categories = ['Electronics', 'Clothing', 'Books', 'Home', 'Sports'];
  const insertProduct = db.prepare(
    'INSERT INTO products (name, price, category) VALUES (?, ?, ?)'
  );
  const insertMany = db.transaction(() => {
    for (let i = 1; i <= 100; i++) {
      insertProduct.run(
        `Product ${i}`,
        parseFloat((Math.random() * 500 + 5).toFixed(2)),
        categories[i % categories.length]
      );
    }
  });
  insertMany();
}

const orderCount = (db.prepare('SELECT COUNT(*) as n FROM orders').get() as { n: number }).n;
if (orderCount === 0) {
  console.log('Seeding 50,000 orders (this guarantees a slow full table scan)...');
  const insertOrder = db.prepare(
    'INSERT INTO orders (customer_id, product_id, quantity, total, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const statuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
  const insertMany = db.transaction(() => {
    for (let i = 0; i < 50000; i++) {
      const customerId = Math.floor(Math.random() * 500) + 1;
      const productId = Math.floor(Math.random() * 100) + 1;
      const qty = Math.floor(Math.random() * 5) + 1;
      const total = parseFloat((qty * (Math.random() * 500 + 5)).toFixed(2));
      insertOrder.run(
        customerId,
        productId,
        qty,
        total,
        statuses[i % statuses.length],
        new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString()
      );
    }
  });
  insertMany();
}

console.log('\nVerifying full table scan with EXPLAIN QUERY PLAN...');
const plan = db
  .prepare('EXPLAIN QUERY PLAN SELECT * FROM orders WHERE customer_id = 1')
  .all() as Array<{ id: number; parent: number; notused: number; detail: string }>;

console.log('\nQuery plan for: SELECT * FROM orders WHERE customer_id = 1');
plan.forEach((row) => console.log(' ', row.detail));

const hasScan = plan.some((r) => r.detail.includes('SCAN'));
console.log(
  hasScan
    ? '\n✅ SCAN confirmed — full table scan on orders (no index on customer_id). Demo is ready!'
    : '\n⚠️  No full scan detected. Check if an index was accidentally created.'
);

const totals = db.prepare('SELECT COUNT(*) as n FROM orders').get() as { n: number };
console.log(`\nDB stats: ${totals.n} orders, 500 customers, 100 products`);
db.close();
